import { Router } from 'express';
import { query } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound, parseText } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';

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
 * Managing accounts means typing amounts, so it needs the same permission as
 * seeing them — otherwise the figures could be read back by editing.
 */
async function requireBalanceAccess(req, res) {
  const { canSeeBalances } = await effectivePermissions(req.session);

  if (!canSeeBalances) {
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

balancesRouter.delete('/:id', asyncRoute(async (req, res) => {
  if (!await requireBalanceAccess(req, res)) {
    return;
  }

  const { rowCount } = await query(
    'delete from balances where id = $1 and user_id = $2',
    [req.params.id, req.session.userId]
  );

  if (rowCount === 0) {
    return notFound(res, 'Balance account not found');
  }

  res.status(204).end();
}));
