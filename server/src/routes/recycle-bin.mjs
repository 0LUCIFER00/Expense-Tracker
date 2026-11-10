import { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { checkBudgetAlertsSafely } from '../budget-store.mjs';
import { afterResponse } from '../after-response.mjs';
import { sweepCleanup } from '../attachment-store.mjs';
import { isConfigured as attachmentStorageReady } from '../attachment-storage.mjs';
import { isUuid } from '../transfers.mjs';
import {
  RETENTION_DAYS,
  daysLeft,
  emptyBin,
  isKind,
  listDeleted,
  purgeEntry,
  restoreExpense,
  restoreIncome
} from '../recycle-store.mjs';

/**
 * Recently deleted, on the Transactions page: what has been removed in the
 * last 30 days, and putting it back or deleting it for good.
 *
 * Seeing the list needs only a session. Restoring and deleting for good need
 * "Remove entries", the switch that guards removing in the first place: they
 * are the two halves of the same decision.
 */
export const recycleBinRouter = Router();

recycleBinRouter.use(requireAuth);

const DAY_MS = 86_400_000;

function toApi(row, { canViewSource }) {
  const deletedAt = new Date(row.deleted_at);

  return {
    kind: row.kind,
    id: row.id,
    description: row.description,
    amountPaise: Math.round(Number(row.amount) * 100),
    date: row.date,
    category: row.category,
    // Gated like the lists: it names an account.
    account: canViewSource ? row.account : null,
    pending: row.status === 'pending',
    deletedAt: row.deleted_at,
    deletedVia: row.deleted_via,
    // Worked out by the database's clock where the query gives them.
    expiresAt: new Date(row.expires_at ?? deletedAt.getTime() + RETENTION_DAYS * DAY_MS).toISOString(),
    daysLeft: row.days_left ?? daysLeft(row.deleted_at),
    // Whether removing it moved money, so restoring will move it again.
    movedMoney: Boolean(row.delete_reversed),
    splitMembers: row.split_members ?? null,
    repays: row.repays ?? null,
    attachmentCount: Number(row.attachments ?? 0)
  };
}

async function requireRemove(req, res) {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canRemove) {
    res.status(403).json({ error: 'You do not have permission to remove entries, so you cannot restore or delete them either.' });
    return null;
  }

  return permissions;
}

/** Reads :kind and :id, answering 400 itself when either is wrong. */
function readTarget(req, res) {
  const { kind, id } = req.params;

  if (!isKind(kind)) {
    badRequest(res, 'That is not a kind of entry.');
    return null;
  }

  if (!isUuid(id)) {
    badRequest(res, 'Malformed identifier.');
    return null;
  }

  return { kind, id };
}

function sendRefusal(res, error) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }

  throw error;
}

/** Receipt rows went with a purged expense (cascade, files queued); remove the files once answered. */
function sweepFilesSoon() {
  if (attachmentStorageReady()) {
    afterResponse(sweepCleanup({ limit: 50 }));
  }
}

recycleBinRouter.get('/', asyncRoute(async (req, res) => {
  const kind = isKind(req.query.kind) ? req.query.kind : null;
  const search = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  const permissions = await effectivePermissions(req.session);
  const rows = await listDeleted(req.session.userId, { kind, search });

  res.json({
    retentionDays: RETENTION_DAYS,
    canManage: permissions.canRemove,
    entries: rows.map(row => toApi(row, permissions))
  });
}));

recycleBinRouter.post('/:kind/:id/restore', asyncRoute(async (req, res) => {
  const target = readTarget(req, res);

  if (!target) return;

  const permissions = await requireRemove(req, res);

  if (!permissions) return;

  try {
    const userId = req.session.userId;
    const options = { canSeeBalances: permissions.canSeeBalances };

    if (target.kind === 'expense') {
      const restored = await restoreExpense(userId, target.id, options);

      // A settled expense counts towards its month's budget again.
      const budgetAlerts = restored.status === 'done'
        ? await checkBudgetAlertsSafely(userId, restored.spent_on)
        : [];

      return res.json({
        kind: 'expense',
        id: restored.id,
        description: restored.description,
        movedMoney: restored.debited,
        account: permissions.canViewSource ? restored.source_category : null,
        balanceAfter: permissions.canSeeBalances ? restored.balanceAfter : null,
        budgetAlerts: budgetAlerts.map(alert => ({ scope: alert.scope, threshold: alert.threshold, message: alert.message }))
      });
    }

    const restored = await restoreIncome(userId, target.id, options);

    res.json({
      kind: 'income',
      id: restored.id,
      description: restored.description,
      movedMoney: restored.credited,
      account: permissions.canViewSource ? restored.target_category : null,
      balanceAfter: permissions.canSeeBalances ? restored.balanceAfter : null,
      budgetAlerts: []
    });
  } catch (error) {
    sendRefusal(res, error);
  }
}));

recycleBinRouter.delete('/:kind/:id', asyncRoute(async (req, res) => {
  const target = readTarget(req, res);

  if (!target) return;

  if (!await requireRemove(req, res)) return;

  try {
    const result = await purgeEntry(req.session.userId, target.kind, target.id);
    sweepFilesSoon();
    res.json(result);
  } catch (error) {
    sendRefusal(res, error);
  }
}));

/** Empties Recently deleted. The body must say so, so a stray request cannot. */
recycleBinRouter.post('/empty', asyncRoute(async (req, res) => {
  if (req.body?.confirm !== 'empty') {
    return badRequest(res, 'Confirm emptying Recently deleted.');
  }

  if (!await requireRemove(req, res)) return;

  const result = await emptyBin(req.session.userId);
  sweepFilesSoon();
  res.json(result);
}));
