import { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, notFound, todayInIndia } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { TRANSITIONS, goalView, readEntry, readGoal } from '../goals.mjs';
import {
  addEntry,
  changeStatus,
  createGoal,
  deleteGoal,
  findGoal,
  listActivity,
  listGoals,
  updateGoal
} from '../goals-store.mjs';

/**
 * Savings goals. Tracking only: nothing here reads or writes balances,
 * expenses, incomes, budgets or recurring schedules.
 *
 * Amounts go out as rupees with paise (two decimals) worked out from whole
 * paise; every figure, percentage and monthly amount is calculated here, never
 * taken from the browser.
 */
export const goalsRouter = Router();

goalsRouter.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rupees = paise => paise === null ? null : paise / 100;

function goalToApi(goal, today) {
  const v = goalView(goal, today);

  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    icon: goal.icon,
    target: rupees(v.targetPaise),
    saved: rupees(v.savedPaise),
    remaining: rupees(v.remainingPaise),
    over: rupees(v.overPaise),
    percent: v.percent,
    targetDate: goal.target_date,
    monthsLeft: v.monthsLeft,
    monthly: rupees(v.monthlyPaise),
    status: goal.status,
    state: v.state,
    createdOn: goal.created_on,
    completedAt: goal.completed_at
  };
}

function entryToApi(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: rupees(entry.amount_paise),
    date: entry.on_date,
    note: entry.note,
    savedAfter: rupees(entry.saved_after_paise),
    createdAt: entry.created_at
  };
}

function readId(req, res) {
  if (!UUID.test(req.params.id)) {
    notFound(res);
    return null;
  }

  return req.params.id;
}

async function requireManage(req, res) {
  const { canManageGoals } = await effectivePermissions(req.session);

  if (!canManageGoals) {
    res.status(403).json({
      error: 'Changing savings goals is switched off for this sign-in. Use your full-access password.'
    });
    return false;
  }

  return true;
}

function sendError(res, error) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }

  throw error;
}

/** Every goal with its figures, the totals, and whether this sign-in may change them. */
goalsRouter.get('/', asyncRoute(async (req, res) => {
  const today = todayInIndia();
  const [goals, permissions] = await Promise.all([
    listGoals(req.session.userId),
    effectivePermissions(req.session)
  ]);

  const sum = key => goals.reduce((total, goal) => total + goal[key], 0);
  const count = status => goals.filter(goal => goal.status === status).length;
  const totalTarget = sum('target_paise');
  const totalSaved = sum('saved_paise');

  res.json({
    today,
    canManage: permissions.canManageGoals,
    goals: goals.map(goal => goalToApi(goal, today)),
    summary: {
      totalTarget: rupees(totalTarget),
      totalSaved: rupees(totalSaved),
      percent: totalTarget > 0 ? Math.floor((totalSaved * 100) / totalTarget) : 0,
      active: count('active'),
      paused: count('paused'),
      completed: count('completed')
    }
  });
}));

goalsRouter.get('/:id/activity', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;

  const goal = await findGoal(req.session.userId, id);
  if (!goal) return notFound(res);

  const activity = await listActivity(req.session.userId, id);
  res.json(activity.map(entryToApi));
}));

goalsRouter.post('/', asyncRoute(async (req, res) => {
  if (!await requireManage(req, res)) return;

  const today = todayInIndia();
  const read = readGoal(req.body, { today, creating: true });

  if (read.error) {
    return res.status(400).json({ error: read.error });
  }

  const goal = await createGoal(req.session.userId, read.value, today);
  res.status(201).json(goalToApi(goal, today));
}));

goalsRouter.put('/:id', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  if (!await requireManage(req, res)) return;

  const current = await findGoal(req.session.userId, id);
  if (!current) return notFound(res);

  const today = todayInIndia();
  const read = readGoal(req.body, { today, creating: false, currentDate: current.target_date });

  if (read.error) {
    return res.status(400).json({ error: read.error });
  }

  const goal = await updateGoal(req.session.userId, id, read.value);
  return goal ? res.json(goalToApi(goal, today)) : notFound(res);
}));

for (const action of Object.keys(TRANSITIONS)) {
  goalsRouter.post(`/:id/${action}`, asyncRoute(async (req, res) => {
    const id = readId(req, res);
    if (!id) return;
    if (!await requireManage(req, res)) return;

    try {
      const goal = await changeStatus(req.session.userId, id, action);
      return goal ? res.json(goalToApi(goal, todayInIndia())) : notFound(res);
    } catch (error) {
      sendError(res, error);
    }
  }));
}

goalsRouter.delete('/:id', asyncRoute(async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  if (!await requireManage(req, res)) return;

  const deleted = await deleteGoal(req.session.userId, id);
  return deleted ? res.status(204).end() : notFound(res);
}));

for (const [path, kind] of [['contributions', 'contribution'], ['withdrawals', 'withdrawal']]) {
  goalsRouter.post(`/:id/${path}`, asyncRoute(async (req, res) => {
    const id = readId(req, res);
    if (!id) return;
    if (!await requireManage(req, res)) return;

    const today = todayInIndia();
    const read = readEntry(req.body, { today });

    if (read.error) {
      return res.status(400).json({ error: read.error });
    }

    try {
      const result = await addEntry(req.session.userId, id, kind, read.value);

      if (!result) {
        return notFound(res);
      }

      res.status(201).json({ goal: goalToApi(result.goal, today), entry: entryToApi(result.entry) });
    } catch (error) {
      sendError(res, error);
    }
  }));
}
