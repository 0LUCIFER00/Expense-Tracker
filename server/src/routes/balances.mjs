import { Router } from 'express';
import { query } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound, parseText } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { accountUsage } from '../transfer-store.mjs';
import { isUuid } from '../transfers.mjs';

export const balancesRouter = Router();

balancesRouter.use(requireAuth);

/**
 * @param visible false hides the amount itself.
 *
 * The account still comes back so the add-expense form can offer it — you can
 * spend from an account without being allowed to see what is in it.
 */
function toApi(row, visible) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    balance: visible ? row.balance : null,
    saved: row.saved,
    /** True when the amount was withheld rather than being genuinely unknown. */
    hidden: !visible
  };
}

balancesRouter.get('/', asyncRoute(async (req, res) => {
  const { canSeeBalances } = await effectivePermissions(req.session);

  const { rows } = await query(
    `select id, type, category, balance, saved
       from balances
      where user_id = $1
      order by created_at`,
    [req.session.userId]
  );

  res.json(rows.map(row => toApi(row, canSeeBalances)));
}));

/**
 * Managing accounts means typing amounts. That needs seeing them, or the
 * figures could be read back by editing; and it needs "Debit from an account",
 * or a session barred from moving money by spending could move it by retyping
 * the balance.
 */
async function requireBalanceAccess(req, res) {
  const { canManageBalances } = await effectivePermissions(req.session);

  if (!canManageBalances) {
    res.status(403).json({
      error: 'Sign in with your full-access password to manage balances.'
    });
    return false;
  }

  return true;
}

/** Both are shown in a cell and quoted in WhatsApp replies, so they stay short. */
const NAME_MAX = 60;

/** The ceiling on a single account, matching numeric(14, 2). */
const BALANCE_MAX = 999_999_999_99.99;

function readBody(body) {
  const type = parseText(body?.type, { field: 'Type', max: NAME_MAX });
  const category = parseText(body?.category, { field: 'Category', max: NAME_MAX });
  const balance = Number(body?.balance);

  if (type.error || category.error) {
    return { error: type.error ?? category.error };
  }

  if (!Number.isFinite(balance) || balance < 0) {
    return { error: 'Balance must be zero or more' };
  }

  // numeric(14, 2) overflows above this, which would surface as a 500.
  if (balance > BALANCE_MAX) {
    return { error: 'That balance is larger than this app can hold' };
  }

  return {
    type: type.value,
    category: category.value,
    balance: Math.round(balance * 100) / 100
  };
}

balancesRouter.post('/', asyncRoute(async (req, res) => {
  if (!await requireBalanceAccess(req, res)) {
    return;
  }

  const parsed = readBody(req.body);

  if (parsed.error) {
    return badRequest(res, parsed.error);
  }

  const { rows } = await query(
    `insert into balances (user_id, type, category, balance, saved)
     values ($1, $2, $3, $4, true)
     returning id, type, category, balance, saved`,
    [req.session.userId, parsed.type, parsed.category, parsed.balance]
  );

  res.status(201).json(toApi(rows[0], true));
}));

balancesRouter.put('/:id', asyncRoute(async (req, res) => {
  if (!await requireBalanceAccess(req, res)) {
    return;
  }

  const parsed = readBody(req.body);

  if (parsed.error) {
    return badRequest(res, parsed.error);
  }

  const { rows } = await query(
    `update balances
        set type = $1, category = $2, balance = $3, saved = true
      where id = $4 and user_id = $5
      returning id, type, category, balance, saved`,
    [parsed.type, parsed.category, parsed.balance, req.params.id, req.session.userId]
  );

  if (!rows[0]) {
    return notFound(res, 'Balance account not found');
  }

  res.json(toApi(rows[0], true));
}));

/**
 * Whether an account can be deleted, and if not, why: what it still holds and
 * what records point at it. The page shows this before asking to confirm.
 */
balancesRouter.get('/:id/usage', asyncRoute(async (req, res) => {
  if (!await requireBalanceAccess(req, res)) {
    return;
  }

  if (!isUuid(req.params.id)) {
    return notFound(res, 'Balance account not found');
  }

  const usage = await accountUsage(req.session.userId, req.params.id);
  return usage ? res.json(usage) : notFound(res, 'Balance account not found');
}));

/**
 * Deletes an account only when nothing would be lost: it holds nothing and no
 * expense, income, transfer or live recurring schedule points at it. Anything
 * else is refused with the reasons, so financial history is never silently
 * cut loose from its account.
 */
balancesRouter.delete('/:id', asyncRoute(async (req, res) => {
  if (!await requireBalanceAccess(req, res)) {
    return;
  }

  if (!isUuid(req.params.id)) {
    return notFound(res, 'Balance account not found');
  }

  const usage = await accountUsage(req.session.userId, req.params.id);

  if (!usage) {
    return notFound(res, 'Balance account not found');
  }

  if (!usage.deletable) {
    return res.status(409).json({
      error: `${usage.name} can't be deleted. ${usage.reasons.join(' ')}`,
      reasons: usage.reasons
    });
  }

  // The balance is checked again in the delete itself, in case money arrived
  // between the check above and now.
  const { rowCount } = await query(
    'delete from balances where id = $1 and user_id = $2 and balance = 0',
    [req.params.id, req.session.userId]
  );

  if (rowCount === 0) {
    return res.status(409).json({ error: 'That account changed meanwhile. Please try again.' });
  }

  res.status(204).end();
}));
