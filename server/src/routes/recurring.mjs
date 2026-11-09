import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound, todayInIndia } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { checkBudgetAlertsSafely } from '../budget-store.mjs';
import { sweepCleanup } from '../attachment-store.mjs';
import { isConfigured as attachmentStorageReady } from '../attachment-storage.mjs';
import {
  daysBetween,
  inReminderWindow,
  monthlyPaise,
  readSchedule,
  upcomingDates
} from '../recurring.mjs';
import {
  createSchedule,
  deleteSchedule,
  findSchedule,
  listRuns,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  retryRun,
  runDue,
  skipRun,
  updateSchedule
} from '../recurring-store.mjs';

export const recurringRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Leaves time to answer inside the platform's 300 second function limit. */
const CRON_BUDGET_MS = 240_000;

function cronAuthorised(req) {
  const secret = process.env['CRON_SECRET'];

  // Without a secret the endpoint is closed, never open.
  if (!secret || secret.length < 16) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(String(req.get('authorization') ?? ''));

  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The daily job. Vercel Cron calls it with "Authorization: Bearer <CRON_SECRET>".
 * It reports counts only: no names, amounts or accounts.
 */
recurringRouter.get('/cron', asyncRoute(async (req, res) => {
  if (!cronAuthorised(req)) {
    return res.status(401).json({ error: 'Not authorised' });
  }

  const today = todayInIndia();
  const { results } = await runDue({ today, deadline: Date.now() + CRON_BUDGET_MS });

  const count = status => results.filter(r => r.status === status).length;

  // Daily housekeeping on the same run: receipt files whose rows are gone
  // (removed, or deleted with their expense or account) and any earlier
  // storage deletion that failed.
  const files = attachmentStorageReady() ? await sweepCleanup({ limit: 500 }) : { removed: 0, failed: 0 };

  console.log(`[recurring] ${today}: ${count('posted')} added, ${count('failed')} failed; ` +
    `receipt files removed ${files.removed}, still queued ${files.failed}`);
  res.json({ today, added: count('posted'), failed: count('failed') });
}));

recurringRouter.use(requireAuth);

function scheduleToApi(s, today) {
  return {
    id: s.id,
    kind: s.kind,
    description: s.description,
    amount: Number(s.amount),
    category: s.category,
    accountId: s.account_id,
    accountName: s.account_name ?? null,
    accountMissing: Boolean(s.uses_account && !s.account_id),
    frequency: s.frequency,
    interval: s.interval_count,
    startOn: s.start_on,
    // The date the schedule counts from: "monthly on the 31st" even in a
    // month whose date is the 30th.
    anchorOn: s.anchor_on,
    nextDueOn: s.next_due_on,
    endOn: s.end_on,
    remindDays: s.remind_days,
    status: s.status,
    postedCount: s.posted_count ?? 0,
    reminderDue: inReminderWindow(s, today),
    nextDates: s.status === 'active' && s.next_due_on
      ? upcomingDates(s, s.next_seq, 3)
      : []
  };
}

function runToApi(r) {
  return {
    id: r.id,
    scheduleId: r.schedule_id,
    dueOn: r.due_on,
    kind: r.kind,
    description: r.description,
    amount: Number(r.amount),
    status: r.status,
    attempts: r.attempts,
    error: r.last_error,
    lastAttemptOn: r.last_attempt_on
  };
}

function outcomeToApi(o) {
  return {
    scheduleId: o.scheduleId,
    runId: o.runId,
    kind: o.kind,
    description: o.description,
    amount: o.amount,
    dueOn: o.dueOn,
    status: o.status,
    error: o.error ?? null
  };
}

/** Upcoming within `days`, and overdue: failed occurrences, or due and not yet run. */
function upcomingView(schedules, failed, today, days) {
  const active = schedules.filter(s => s.status === 'active' && s.next_due_on);

  return {
    upcoming: active
      .filter(s => s.next_due_on >= today && daysBetween(today, s.next_due_on) <= days)
      .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on))
      .map(s => scheduleToApi(s, today)),
    overdue: [
      ...active.filter(s => s.next_due_on < today).map(s => ({
        type: 'not-run', schedule: scheduleToApi(s, today)
      })),
      ...failed.map(r => ({ type: 'failed', run: runToApi(r) }))
    ]
  };
}

async function requireManage(req, res) {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canManageRecurring) {
    res.status(403).json({
      error: 'Changing recurring schedules is switched off for this sign-in. Use your full-access password.'
    });
    return null;
  }

  return permissions;
}

/**
 * The money rules the matching one-off entry has: an expense that takes money
 * from an account needs "update balance"; income needs Add Income and it.
 */
function moneyRuleRefusal(kind, accountId, permissions) {
  if (kind === 'income' && !(permissions.canAddMoney && permissions.canUpdateBalance)) {
    return 'Adding income is switched off for this sign-in.';
  }

  if (kind === 'expense' && accountId && !permissions.canUpdateBalance) {
    return 'This sign-in may not change balances. Choose "No account" or use your full-access password.';
  }

  return null;
}

function readId(req, res, name = 'id') {
  const id = req.params[name];

  if (!UUID.test(id)) {
    notFound(res, 'Not found');
    return null;
  }

  return id;
}

function sendError(res, error) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }

  throw error;
}

/** Everything the Recurring page shows, in one request. */
recurringRouter.get('/', asyncRoute(async (req, res) => {
  const today = todayInIndia();
  const userId = req.session.userId;

  const [schedules, failed, recent, permissions] = await Promise.all([
    listSchedules(userId),
    listRuns(userId, { failedOnly: true, limit: 50 }),
    listRuns(userId, { limit: 8 }),
    effectivePermissions(req.session)
  ]);

  const active = schedules.filter(s => s.status === 'active');
  const perMonth = kind => active
    .filter(s => s.kind === kind)
    .reduce((sum, s) => sum + monthlyPaise(s), 0) / 100;

  res.json({
    today,
    canManage: permissions.canManageRecurring,
    schedules: schedules.map(s => scheduleToApi(s, today)),
    ...upcomingView(schedules, failed, today, 7),
    recent: recent.map(runToApi),
    summary: {
      active: active.length,
      dueThisWeek: active.filter(s => daysBetween(today, s.next_due_on) <= 7 && s.next_due_on >= today).length,
      attention: failed.length,
      monthlyOut: perMonth('expense'),
      monthlyIn: perMonth('income')
    }
  });
}));

recurringRouter.get('/upcoming', asyncRoute(async (req, res) => {
  const days = req.query.days === undefined ? 7 : Number(req.query.days);

  if (!Number.isInteger(days) || days < 0 || days > 60) {
    return badRequest(res, 'days must be 0 to 60');
  }

  const today = todayInIndia();
  const [schedules, failed] = await Promise.all([
    listSchedules(req.session.userId),
    listRuns(req.session.userId, { failedOnly: true, limit: 50 })
  ]);

  res.json({ today, ...upcomingView(schedules, failed, today, days) });
}));

recurringRouter.get('/runs', asyncRoute(async (req, res) => {
  const runs = await listRuns(req.session.userId, { limit: 50 });
  res.json(runs.map(runToApi));
}));

/**
 * Adds whatever of this account's has come due, so entries appear on their day
 * even if the daily job is late. Any signed-in session may trigger it: it only
 * carries out schedules that were set up with the right permission.
 */
recurringRouter.post('/sync', asyncRoute(async (req, res) => {
  const userId = req.session.userId;
  const today = todayInIndia();
  const { results, budgetAlerts } = await runDue({ today, userId });

  const [schedules, failed] = await Promise.all([
    listSchedules(userId),
    listRuns(userId, { failedOnly: true, limit: 50 })
  ]);

  res.json({
    today,
    added: results.filter(r => r.status === 'posted').map(outcomeToApi),
    failed: results.filter(r => r.status === 'failed').map(outcomeToApi),
    attention: failed.length,
    reminders: schedules
      .filter(s => inReminderWindow(s, today))
      .map(s => scheduleToApi(s, today)),
    budgetAlerts: budgetAlerts.map(alert => ({
      scope: alert.scope, threshold: alert.threshold, message: alert.message
    }))
  });
}));

recurringRouter.get('/:id/runs', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;

  const schedule = await findSchedule(req.session.userId, id);

  if (!schedule) {
    return notFound(res);
  }

  const runs = await listRuns(req.session.userId, { scheduleId: id, limit: 100 });
  res.json(runs.map(runToApi));
}));

recurringRouter.post('/', asyncRoute(async (req, res) => {
  const permissions = await requireManage(req, res);
  if (!permissions) return;

  const today = todayInIndia();
  const read = readSchedule(req.body, { today, canBackdate: permissions.canBackdate, creating: true });

  if (read.error) {
    return res.status(read.status ?? 400).json({ error: read.error });
  }

  const refusal = moneyRuleRefusal(read.value.kind, read.value.accountId, permissions);

  if (refusal) {
    return res.status(403).json({ error: refusal });
  }

  try {
    const created = await createSchedule(req.session.userId, read.value);
    res.status(201).json(scheduleToApi(created, today));
  } catch (error) {
    sendError(res, error);
  }
}));

recurringRouter.put('/:id', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;

  const permissions = await requireManage(req, res);
  if (!permissions) return;

  const current = await findSchedule(req.session.userId, id);

  if (!current) {
    return notFound(res);
  }

  const today = todayInIndia();
  const read = readSchedule(req.body, {
    today,
    // Keeping the date it already has is not backdating.
    canBackdate: permissions.canBackdate || req.body?.nextDueOn === current.next_due_on,
    creating: false,
    kind: current.kind
  });

  if (read.error) {
    return res.status(read.status ?? 400).json({ error: read.error });
  }

  const refusal = moneyRuleRefusal(current.kind, read.value.accountId, permissions);

  if (refusal) {
    return res.status(403).json({ error: refusal });
  }

  try {
    const updated = await updateSchedule(req.session.userId, id, read.value);

    if (!updated) {
      return notFound(res);
    }

    res.json(scheduleToApi(updated, today));
  } catch (error) {
    sendError(res, error);
  }
}));

recurringRouter.post('/:id/pause', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  if (!await requireManage(req, res)) return;

  const schedule = await pauseSchedule(req.session.userId, id);
  return schedule ? res.json(scheduleToApi(schedule, todayInIndia())) : notFound(res);
}));

recurringRouter.post('/:id/resume', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  if (!await requireManage(req, res)) return;

  const today = todayInIndia();
  const schedule = await resumeSchedule(req.session.userId, id, today);
  return schedule ? res.json(scheduleToApi(schedule, today)) : notFound(res);
}));

recurringRouter.delete('/:id', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  if (!await requireManage(req, res)) return;

  const deleted = await deleteSchedule(req.session.userId, id);
  return deleted ? res.status(204).end() : notFound(res);
}));

recurringRouter.post('/runs/:runId/retry', asyncRoute(async (req, res) => {
  const runId = readId(req, res, 'runId');
  if (!runId) return;

  const permissions = await requireManage(req, res);
  if (!permissions) return;

  const run = (await listRuns(req.session.userId, { failedOnly: true, limit: 50 }))
    .find(r => r.id === runId);

  if (!run) {
    return notFound(res, 'Nothing to try again');
  }

  const refusal = moneyRuleRefusal(run.kind, run.account_id, permissions);

  if (refusal) {
    return res.status(403).json({ error: refusal });
  }

  const outcome = await retryRun(runId, todayInIndia(), { userId: req.session.userId });

  if (!outcome) {
    return notFound(res, 'Nothing to try again');
  }

  const budgetAlerts = outcome.status === 'posted' && outcome.kind === 'expense'
    ? await checkBudgetAlertsSafely(req.session.userId, outcome.dueOn)
    : [];

  res.json({
    ...outcomeToApi(outcome),
    budgetAlerts: budgetAlerts.map(alert => ({
      scope: alert.scope, threshold: alert.threshold, message: alert.message
    }))
  });
}));

recurringRouter.post('/runs/:runId/skip', asyncRoute(async (req, res) => {
  const runId = readId(req, res, 'runId');
  if (!runId) return;
  if (!await requireManage(req, res)) return;

  const run = await skipRun(req.session.userId, runId);
  return run ? res.json(runToApi(run)) : notFound(res, 'Nothing to skip');
}));
