import { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, callerToday, parseDate } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { isUuid, readTransfer } from '../transfers.mjs';
import { createTransfer, listTransfers } from '../transfer-store.mjs';

/**
 * Transfers between the user's own accounts. Neither income nor an expense:
 * nothing here touches those tables, budgets or recurring schedules.
 */
export const transfersRouter = Router();

transfersRouter.use(requireAuth);

const rupees = paise => paise / 100;

function toApi(t) {
  return {
    id: t.id,
    fromAccountId: t.from_account_id,
    toAccountId: t.to_account_id,
    fromType: t.from_type,
    fromName: t.from_name,
    toType: t.to_type,
    toName: t.to_name,
    amount: rupees(t.amount_paise),
    date: t.transfer_date,
    description: t.description,
    createdAt: t.created_at
  };
}

/** The history, newest first. Seeing it needs what seeing the accounts needs. */
transfersRouter.get('/', asyncRoute(async (req, res) => {
  const { canSeeBalances } = await effectivePermissions(req.session);

  if (!canSeeBalances) {
    return res.status(403).json({ error: 'Sign in with your full-access password to see transfers.' });
  }

  const accountId = req.query.account ? String(req.query.account) : null;
  const from = req.query.from ? parseDate(req.query.from) : null;
  const to = req.query.to ? parseDate(req.query.to) : null;

  if ((accountId && !isUuid(accountId)) || (req.query.from && !from) || (req.query.to && !to)) {
    return badRequest(res, 'Those filters could not be read.');
  }

  const transfers = await listTransfers(req.session.userId, { accountId, from, to });
  res.json(transfers.map(toApi));
}));

/**
 * Moves money between two accounts. Needs what changing a balance needs
 * ("Debit from an account" and seeing balances), as Cash & Accounts does.
 */
transfersRouter.post('/', asyncRoute(async (req, res) => {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canManageBalances) {
    return res.status(403).json({ error: 'Sign in with your full-access password to move money between accounts.' });
  }

  const read = readTransfer(req.body, {
    today: callerToday(req.body?.tzOffset),
    canBackdate: permissions.canBackdate
  });

  if (read.error) {
    return res.status(read.status ?? 400).json({ error: read.error });
  }

  try {
    const result = await createTransfer(req.session.userId, read.value);

    res.status(result.duplicate ? 200 : 201).json({
      transfer: toApi(result.transfer),
      fromBalance: result.fromBalance,
      toBalance: result.toBalance,
      duplicate: result.duplicate
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  }
}));
