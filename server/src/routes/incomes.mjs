import { Router } from 'express';
import { query } from '../db.mjs';
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
import { INCOME_CATEGORIES, normaliseIncomeCategory } from '../categories.mjs';
import { addIncome, removeIncome, INCOME_COLUMNS } from '../income-store.mjs';

export const incomesRouter = Router();

/** Matches the cap on an expense description; the two are shown side by side. */
const DESCRIPTION_MAX = 200;

incomesRouter.use(requireAuth);

incomesRouter.get('/categories', (_req, res) => res.json(INCOME_CATEGORIES));

function toApi(row, { canViewSource }) {
  return {
    id: row.id,
    amount: row.amount,
    description: row.description,
    date: row.received_on,
    category: row.category,
    // Gated the same way an expense's source is: it names an account.
    targetId: canViewSource ? row.target_id : null,
    targetType: canViewSource ? row.target_type : null,
    targetCategory: canViewSource ? row.target_category : null,
    balanceUpdated: row.balance_updated,
    createdAt: row.created_at,
    // Set when this was someone paying back their part of a split expense,
    // rather than income. The description is only looked up for the list.
    splitExpenseId: row.split_expense_id ?? null,
    splitDescription: row.split_description ?? null,
    // As on an expense: where an imported entry came from, with its notes.
    imported: row.import_info ?? null,
    // Interest received on a loan, filed by Lending & Borrowing.
    loanRepaymentId: row.loan_repayment_id ?? null
  };
}

incomesRouter.get('/', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  const { rows } = await query(
    `select ${INCOME_COLUMNS},
            (select e.description
               from expenses e
              where e.id = incomes.split_expense_id) as split_description,
            (select json_build_object(
                      'fileName', b.file_name, 'notes', r.notes, 'paymentMethod', r.payment_method)
               from import_rows r
               join import_batches b on b.id = r.batch_id
              where r.income_id = incomes.id) as import_info
       from incomes
      where user_id = $1 and deleted_at is null
      order by received_on desc, created_at desc`,
    [req.session.userId]
  );

  res.json(rows.map(row => toApi(row, permissions)));
}));

incomesRouter.post('/', asyncRoute(async (req, res) => {
  const amount = parseAmount(req.body?.amount);
  const description = parseText(req.body?.description, {
    field: 'Description',
    max: DESCRIPTION_MAX
  });
  const date = parseDate(req.body?.date);
  const targetId = req.body?.targetId ? String(req.body.targetId) : null;
  const category = normaliseIncomeCategory(req.body?.category);
  const splitExpenseId = req.body?.splitExpenseId ? String(req.body.splitExpenseId) : null;

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
    return badRequest(res, 'That is not one of the money-in categories');
  }

  const permissions = await effectivePermissions(req.session);

  if (!permissions.canAddMoney) {
    return res.status(403).json({
      error: 'Adding money is switched off for this account.'
    });
  }

  /*
   * Adding money raises a balance, so it needs the same permission as spending
   * from one. Without it there is nothing useful to do here: the entry could
   * be recorded but the account could not change, which is not what the page
   * says it does.
   */
  if (!permissions.canUpdateBalance) {
    return res.status(403).json({
      error: 'This account may not change balances. Sign in with your full-access password.'
    });
  }

  if (!targetId) {
    return badRequest(res, 'Please choose the account the money went into.');
  }

  /*
   * Another day needs "Change transaction dates", as it does for an expense.
   * An expense waits for approval instead; income has no approval step, and a
   * credit that has not happened yet should not sit in the balance, so it is
   * refused outright.
   */
  if (date !== callerToday(req.body?.tzOffset) && !permissions.canBackdate) {
    return res.status(403).json({
      error:
        'Income can only be recorded for today on this sign-in. Other dates need ' +
        '"Change transaction dates", or your full-access password.'
    });
  }

  try {
    const created = await addIncome(req.session.userId, {
      amount,
      description: description.value,
      receivedOn: date,
      category,
      targetId,
      splitExpenseId,
      channel: 'web'
    });

    res.status(201).json({
      ...toApi({ ...created, split_description: created.split?.description }, permissions),
      // How the split stands now, so the page can say what is still to come.
      split: created.split ?? null,
      // Only when this session may see amounts at all.
      balanceAfter: permissions.canSeeBalances ? created.balanceAfter : null
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  }
}));

incomesRouter.delete('/:id', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canRemove) {
    return res.status(403).json({ error: 'You do not have permission to remove entries' });
  }

  // Into Recently deleted, not gone: restorable for 30 days.
  let removed;

  try {
    removed = await removeIncome(req.session.userId, {
      incomeId: req.params.id,
      via: req.session.loginType === 'admin' ? 'admin' : 'user'
    });
  } catch (error) {
    // Interest filed by Lending & Borrowing is undone there, not here.
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  }

  if (!removed) {
    return notFound(res, 'Entry not found');
  }

  // The account has already been spent down past this credit, so taking it back
  // would push the balance below zero. The entry stays rather than the books
  // going wrong quietly.
  if (removed.shortfall) {
    return res.status(409).json({
      error:
        `${removed.target_category} no longer holds that much, so this cannot be ` +
        'taken back. Remove what it was spent on first.'
    });
  }

  res.json({
    id: removed.id,
    reversed: removed.reversed,
    targetCategory: removed.target_category,
    recentlyDeleted: true
  });
}));
