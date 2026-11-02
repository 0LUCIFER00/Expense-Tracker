import { Router } from 'express';
import { query } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound } from '../http.mjs';

export const balancesRouter = Router();

balancesRouter.use(requireAuth);

function toApi(row) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    balance: row.balance,
    saved: row.saved
  };
}

balancesRouter.get('/', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `select id, type, category, balance, saved
       from balances
      where user_id = $1
      order by created_at`,
    [req.session.userId]
  );

  res.json(rows.map(toApi));
}));

function readBody(body) {
  const type = String(body?.type ?? '').trim();
  const category = String(body?.category ?? '').trim();
  const balance = Number(body?.balance);

  if (!type || !category) {
    return { error: 'Type and category are required' };
  }

  if (!Number.isFinite(balance) || balance < 0) {
    return { error: 'Balance must be zero or more' };
  }

  return { type, category, balance: Math.round(balance * 100) / 100 };
}

balancesRouter.post('/', asyncRoute(async (req, res) => {
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

  res.status(201).json(toApi(rows[0]));
}));

balancesRouter.put('/:id', asyncRoute(async (req, res) => {
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

  res.json(toApi(rows[0]));
}));

balancesRouter.delete('/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await query(
    'delete from balances where id = $1 and user_id = $2',
    [req.params.id, req.session.userId]
  );

  if (rowCount === 0) {
    return notFound(res, 'Balance account not found');
  }

  res.status(204).end();
}));
