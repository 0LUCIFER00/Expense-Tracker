import { Router } from 'express';
import { query, transaction } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import {
  asyncRoute,
  badRequest,
  callerToday,
  notFound,
  parseAmount,
  parseDate,
  parseText
} from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { insertExpense, removeExpense } from '../expense-store.mjs';
import { checkBudgetAlertsSafely } from '../budget-store.mjs';

/** Thresholds just crossed, as the page shows them: the sentence and its weight. */
function alertsForApi(alerts) {
  return alerts.map(alert => ({
    scope: alert.scope,
    threshold: alert.threshold,
    message: alert.message
  }));
}
import { CATEGORIES, normaliseCategory } from '../categories.mjs';
import { MAX_MEMBERS, MIN_MEMBERS, parseMembers, splitAmount } from '../split.mjs';
import { listSplits } from '../split-store.mjs';

export const expensesRouter = Router();

/** Long enough for anything anyone types; short enough to render in a cell. */
const DESCRIPTION_MAX = 200;

expensesRouter.use(requireAuth);

expensesRouter.get('/categories', (_req, res) => res.json(CATEGORIES));

/**
 * Every split expense, with how much has come back on each. Add Money lists the
 * ones still owed on, so a repayment can be filed against the right one.
 */
expensesRouter.get('/splits', asyncRoute(async (req, res) => {
  res.json(await listSplits(req.session.userId));
}));

const STATUS_LABEL = {
  done: 'Done',
  pending: 'Pending / Waiting Admin'
};

function toApi(row, { canViewSource }) {
  return {
    id: row.id,
    amount: row.amount,
    description: row.description,
    date: row.spent_on,
    // Null for entries made before categories existed; the UI words that.
    category: row.category,
    // The source columns are the permission-gated ones; hide them server-side
    // rather than relying on the UI not to render them.
    sourceId: canViewSource ? row.source_id : null,
    sourceType: canViewSource ? row.source_type : null,
    sourceCategory: canViewSource ? row.source_category : null,
    expenseAccess: row.expense_access,
    updatePermission: row.update_permission,
    balanceUpdated: row.balance_updated,
    status: STATUS_LABEL[row.status],
    remarks: row.remarks,
    isPendingApproval: row.status === 'pending',
    createdAt: row.created_at,
    // Null for an ordinary expense. A split one counts only personalShare
    // towards the owner's spending; the whole amount still left the account.
    splitMembers: row.split_members,
    splitShare: row.split_share,
    personalShare: row.personal_share,
    // Paid back so far. Only the list query works it out; anywhere else a new
    // or just-approved entry has had nothing paid back against it yet.
    splitReceived: Number(row.split_received ?? 0)
  };
}

const SELECT_COLUMNS = `
  id, amount, description, spent_on, category,
  source_id, source_type, source_category,
  expense_access, update_permission, balance_updated, status, remarks, created_at,
  split_members, split_share, personal_share
`;

expensesRouter.get('/', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  const { rows } = await query(
    `select ${SELECT_COLUMNS},
            (select coalesce(sum(i.amount), 0)
               from incomes i
              where i.split_expense_id = expenses.id) as split_received
       from expenses
      where user_id = $1
      order by created_at`,
    [req.session.userId]
  );

  res.json(rows.map(row => toApi(row, permissions)));
}));

expensesRouter.post('/', asyncRoute(async (req, res) => {
  const amount = parseAmount(req.body?.amount);
  const description = parseText(req.body?.description, {
    field: 'Description',
    max: DESCRIPTION_MAX
  });
  const date = parseDate(req.body?.date);
  const sourceId = req.body?.sourceId ? String(req.body.sourceId) : null;
  const category = normaliseCategory(req.body?.category);
  const wantsBalanceUpdate = Boolean(req.body?.updateBalance);

  // Absent, null or empty means an ordinary expense; anything else has to be a
  // real head count, or the shares worked out from it mean nothing.
  const rawMembers = req.body?.splitMembers;
  const wantsSplit = rawMembers !== undefined && rawMembers !== null && rawMembers !== '';
  const members = wantsSplit ? parseMembers(rawMembers) : null;

  if (amount === null) {
    return badRequest(res, 'Amount must be between 1 and 100000');
  }

  if (description.error) {
    return badRequest(res, description.error);
  }

  if (!date) {
    return badRequest(res, 'A valid date is required');
  }

  if (req.body?.category && !category) {
    return badRequest(res, 'That is not one of the expense categories');
  }

  if (wantsSplit && members === null) {
    return badRequest(
      res,
      `Split it between ${MIN_MEMBERS} and ${MAX_MEMBERS} people, counting yourself.`
    );
  }

  const split = members ? splitAmount(amount, members) : null;

  const permissions = await effectivePermissions(req.session);
  const updateBalance = wantsBalanceUpdate && permissions.canUpdateBalance;

  if (updateBalance && !sourceId) {
    return badRequest(res, 'Please select a balance account.');
  }

  // An entry dated today settles immediately. Any other date needs the
  // past/future permission, otherwise it queues for an admin.
  const isToday = date === callerToday(req.body?.tzOffset);
  const status = isToday || permissions.canBackdate ? 'done' : 'pending';

  try {
    const created = await transaction(client =>
      insertExpense(client, req.session.userId, {
        amount,
        description: description.value,
        date,
        category,
        sourceId,
        updateBalance,
        canBackdate: permissions.canBackdate,
        status,
        members,
        split
      }, SELECT_COLUMNS)
    );

    // After the commit, so the check never holds the account lock. Only a
    // settled expense counts towards a budget; a pending one waits.
    const budgetAlerts = created.status === 'done'
      ? await checkBudgetAlertsSafely(req.session.userId, created.spent_on)
      : [];

    res.status(201).json({ ...toApi(created, permissions), budgetAlerts: alertsForApi(budgetAlerts) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  }
}));

/** Admin action: settle a pending entry, applying its debit if it had one. */
expensesRouter.post('/:id/approve', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canBackdate) {
    return res.status(403).json({ error: 'You do not have permission to approve entries' });
  }

  try {
    const approved = await transaction(async client => {
      const { rows } = await client.query(
        `select ${SELECT_COLUMNS} from expenses
          where id = $1 and user_id = $2 and status = 'pending'
          for update`,
        [req.params.id, req.session.userId]
      );

      const expense = rows[0];

      if (!expense) {
        throw Object.assign(new Error('Pending entry not found'), { status: 404 });
      }

      let debited = false;

      if (expense.expense_access && expense.source_id) {
        const balanceResult = await client.query(
          'select id, balance from balances where id = $1 and user_id = $2 for update',
          [expense.source_id, req.session.userId]
        );

        const source = balanceResult.rows[0];

        if (!source) {
          throw Object.assign(new Error('Balance account not found.'), { status: 409 });
        }

        if (Number(source.balance) < Number(expense.amount)) {
          throw Object.assign(new Error('Insufficient balance.'), { status: 409 });
        }

        await client.query(
          'update balances set balance = balance - $1 where id = $2',
          [expense.amount, source.id]
        );

        debited = true;
      }

      const updated = await client.query(
        `update expenses
            set status = 'done',
                balance_updated = $1,
                update_permission = true,
                remarks = $2
          where id = $3
          returning ${SELECT_COLUMNS}`,
        [
          debited,
          debited ? 'Added and balance updated by admin' : 'Added in list by admin',
          expense.id
        ]
      );

      return updated.rows[0];
    });

    // Approval is when a pending expense starts counting towards its month.
    const budgetAlerts = await checkBudgetAlertsSafely(req.session.userId, approved.spent_on);

    res.json({ ...toApi(approved, permissions), budgetAlerts: alertsForApi(budgetAlerts) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  }
}));

expensesRouter.delete('/:id', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canRemove) {
    return res.status(403).json({ error: 'You do not have permission to remove entries' });
  }

  // Shared with WhatsApp's "undo": removing an entry that debited an account
  // puts the money back, so the balances keep matching the list.
  const removed = await removeExpense(req.session.userId, { expenseId: req.params.id });

  if (!removed) {
    return notFound(res, 'Expense not found');
  }

  res.json({
    id: removed.id,
    refunded: removed.refunded,
    sourceCategory: removed.source_category,
    // Repayments made against it stay, as ordinary money in: that money did
    // arrive, whatever happens to the expense.
    detachedRepayments: removed.detachedRepayments
  });
}));
