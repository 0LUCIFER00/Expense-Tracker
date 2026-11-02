import { Router } from 'express';
import { query, transaction } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound, parseAmount, parseDate } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { removeExpense } from '../expense-store.mjs';

export const expensesRouter = Router();

expensesRouter.use(requireAuth);

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
    createdAt: row.created_at
  };
}

const SELECT_COLUMNS = `
  id, amount, description, spent_on, source_id, source_type, source_category,
  expense_access, update_permission, balance_updated, status, remarks, created_at
`;

/**
 * "Today" according to the caller's clock. The browser sends its UTC offset so
 * that someone just after midnight locally does not have their entry treated
 * as a future date by a server running in UTC.
 */
function callerToday(offsetMinutes) {
  const offset = Number(offsetMinutes);
  const safeOffset = Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0;

  // getTimezoneOffset() is minutes *behind* UTC, hence the subtraction.
  const local = new Date(Date.now() - safeOffset * 60_000);

  return local.toISOString().slice(0, 10);
}

expensesRouter.get('/', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  const { rows } = await query(
    `select ${SELECT_COLUMNS}
       from expenses
      where user_id = $1
      order by created_at`,
    [req.session.userId]
  );

  res.json(rows.map(row => toApi(row, permissions)));
}));

expensesRouter.post('/', asyncRoute(async (req, res) => {
  const amount = parseAmount(req.body?.amount);
  const description = String(req.body?.description ?? '').trim();
  const date = parseDate(req.body?.date);
  const sourceId = req.body?.sourceId ? String(req.body.sourceId) : null;
  const wantsBalanceUpdate = Boolean(req.body?.updateBalance);

  if (amount === null) {
    return badRequest(res, 'Amount must be between 1 and 100000');
  }

  if (!description) {
    return badRequest(res, 'Description is required');
  }

  if (!date) {
    return badRequest(res, 'A valid date is required');
  }

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
    const created = await transaction(async client => {
      let source = null;

      if (sourceId) {
        // Lock the row so two concurrent expenses cannot both pass the
        // sufficient-funds check against the same balance.
        const { rows } = await client.query(
          `select id, type, category, balance
             from balances
            where id = $1 and user_id = $2 and saved = true
            for update`,
          [sourceId, req.session.userId]
        );

        source = rows[0] ?? null;

        if (!source) {
          throw Object.assign(new Error('Please select a valid balance account.'), {
            status: 400
          });
        }
      }

      // Only a settled entry moves money; a pending one waits for approval.
      const debit = updateBalance && status === 'done';

      if (debit) {
        if (Number(source.balance) < amount) {
          throw Object.assign(new Error('Insufficient balance.'), { status: 409 });
        }

        await client.query(
          'update balances set balance = balance - $1 where id = $2',
          [amount, source.id]
        );
      }

      const remarks = status === 'pending'
        ? (updateBalance ? 'Wait for admin to add and update balance' : 'Wait for admin to add')
        : (debit ? 'Added and balance updated' : 'Added in list');

      const { rows } = await client.query(
        `insert into expenses (
           user_id, amount, description, spent_on,
           source_id, source_type, source_category,
           expense_access, update_permission, balance_updated, status, remarks
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning ${SELECT_COLUMNS}`,
        [
          req.session.userId, amount, description, date,
          source?.id ?? null, source?.type ?? null, source?.category ?? null,
          updateBalance, permissions.canBackdate, debit, status, remarks
        ]
      );

      return rows[0];
    });

    res.status(201).json(toApi(created, permissions));
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

    res.json(toApi(approved, permissions));
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
    sourceCategory: removed.source_category
  });
}));
