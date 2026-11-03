import { Router } from 'express';
import { query } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound, parseAmount, parseDate } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { INCOME_CATEGORIES, normaliseIncomeCategory } from '../categories.mjs';
import { addIncome, removeIncome, INCOME_COLUMNS } from '../income-store.mjs';

export const incomesRouter = Router();

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
    createdAt: row.created_at
  };
}

incomesRouter.get('/', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  const { rows } = await query(
    `select ${INCOME_COLUMNS}
       from incomes
      where user_id = $1
      order by received_on desc, created_at desc`,
    [req.session.userId]
  );

  res.json(rows.map(row => toApi(row, permissions)));
}));

incomesRouter.post('/', asyncRoute(async (req, res) => {
  const amount = parseAmount(req.body?.amount);
  const description = String(req.body?.description ?? '').trim();
  const date = parseDate(req.body?.date);
  const targetId = req.body?.targetId ? String(req.body.targetId) : null;
  const category = normaliseIncomeCategory(req.body?.category);

  if (amount === null) {
    return badRequest(res, 'Amount must be between 1 and 100000');
  }

  if (!description) {
    return badRequest(res, 'Description is required');
  }

  if (!date) {
    return badRequest(res, 'A valid date is required');
  }

  if (req.body?.category && !category) {
    return badRequest(res, 'That is not one of the money-in categories');
  }

  const permissions = await effectivePermissions(req.session);

  /*
   * Adding money raises a balance, so it needs the same permission as spending
   * from one. Without it there is nothing useful to do here: the entry could
   * be recorded but the account could not change, which is not what the page
   * says it does.
   */
  if (!permissions.canUpdateBalance) {
    return res.status(403).json({
      error: 'This account may not change balances. Sign in with your admin password.'
    });
  }

  if (!targetId) {
    return badRequest(res, 'Please choose the account the money went into.');
  }

  try {
    const created = await addIncome(req.session.userId, {
      amount,
      description,
      receivedOn: date,
      category,
      targetId,
      channel: 'web'
    });

    res.status(201).json({
      ...toApi(created, permissions),
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

  const removed = await removeIncome(req.session.userId, { incomeId: req.params.id });

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
    targetCategory: removed.target_category
  });
}));
