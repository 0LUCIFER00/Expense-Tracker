import { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, parseAmount } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import {
  BUDGET_CATEGORIES,
  BUDGET_MAX,
  buildMonthView,
  normaliseBudgetCategory,
  parseMonth,
  toPaise
} from '../budget.mjs';
import {
  loadHistory,
  loadMonth,
  loadPreviousBudget,
  saveBudget
} from '../budget-store.mjs';

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

const BAD_MONTH = 'Choose a month as YYYY-MM, no more than two years ahead.';
const BAD_AMOUNT = 'Enter an amount above ₹0 and no more than ₹99,99,99,999.';

/** A budget amount in paise, or null when it is not a valid one. */
function amountInPaise(value) {
  const amount = parseAmount(value, { max: BUDGET_MAX });
  return amount === null ? null : toPaise(amount);
}

function readMonth(req, res) {
  const month = parseMonth(req.params.month);

  if (!month) {
    badRequest(res, BAD_MONTH);
  }

  return month;
}

/** Changing a budget needs "Manage budgets"; seeing one needs nothing extra. */
async function requireManage(req, res) {
  const { canManageBudgets } = await effectivePermissions(req.session);

  if (!canManageBudgets) {
    res.status(403).json({
      error: 'Changing budgets is switched off for this sign-in. Use your full-access password.'
    });
    return false;
  }

  return true;
}

async function monthView(req, month) {
  const [{ budget, spending, alerts }, permissions] = await Promise.all([
    loadMonth(req.session.userId, month),
    effectivePermissions(req.session)
  ]);

  return buildMonthView({ month, budget, spending, alerts, canManage: permissions.canManageBudgets });
}

/**
 * The whole budget from a request body: { total, categories: [{ category, amount }] }.
 *
 * @returns { total, categories } in paise, or { error }
 */
function readBudget(body) {
  const rawTotal = body?.total;
  let total = null;

  if (rawTotal !== null && rawTotal !== undefined && rawTotal !== '') {
    total = amountInPaise(rawTotal);

    if (total === null) {
      return { error: `Overall budget: ${BAD_AMOUNT}` };
    }
  }

  const list = body?.categories ?? [];

  if (!Array.isArray(list) || list.length > BUDGET_CATEGORIES.length) {
    return { error: 'Categories must be a list of { category, amount }.' };
  }

  const categories = [];
  const seen = new Set();

  for (const entry of list) {
    const category = normaliseBudgetCategory(entry?.category);

    if (!category) {
      return { error: 'That is not one of the expense categories.' };
    }

    if (seen.has(category)) {
      return { error: `${category} is listed twice. Give each category one budget.` };
    }

    const amount = amountInPaise(entry?.amount);

    if (amount === null) {
      return { error: `${category}: ${BAD_AMOUNT}` };
    }

    seen.add(category);
    categories.push({ category, amount });
  }

  return { total, categories };
}

budgetsRouter.get('/categories', (_req, res) => res.json(BUDGET_CATEGORIES));

/**
 * Several months side by side. Declared before /:month so "history" is not
 * read as a month.
 */
budgetsRouter.get('/history', asyncRoute(async (req, res) => {
  const end = parseMonth(req.query['end'] ?? '') ?? null;
  const count = Number(req.query['months'] ?? 6);

  if (!end) {
    return badRequest(res, BAD_MONTH);
  }

  if (!Number.isInteger(count) || count < 2 || count > 12) {
    return badRequest(res, 'History covers between 2 and 12 months.');
  }

  res.json(await loadHistory(req.session.userId, end, count));
}));

budgetsRouter.get('/:month', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (month) {
    res.json(await monthView(req, month));
  }
}));

/** The latest earlier month with a budget, to copy from. Amounts only. */
budgetsRouter.get('/:month/previous', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (!month) {
    return;
  }

  const previous = await loadPreviousBudget(req.session.userId, month);

  if (!previous) {
    return res.json(null);
  }

  res.json({
    month: previous.month.key,
    total: previous.budget.total === null ? null : previous.budget.total / 100,
    categories: previous.budget.categories.map(entry => ({
      category: entry.category,
      amount: entry.amount / 100
    }))
  });
}));

/** Creates or replaces the month: what the edit form and a confirmed copy send. */
budgetsRouter.put('/:month', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (!month || !await requireManage(req, res)) {
    return;
  }

  const next = readBudget(req.body);

  if (next.error) {
    return badRequest(res, next.error);
  }

  await saveBudget(req.session.userId, month, () => next);

  res.json(await monthView(req, month));
}));

/** Sets the overall amount, or clears it with null. */
budgetsRouter.put('/:month/total', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (!month || !await requireManage(req, res)) {
    return;
  }

  const raw = req.body?.amount;
  const total = raw === null || raw === undefined || raw === '' ? null : amountInPaise(raw);

  if (raw !== null && raw !== undefined && raw !== '' && total === null) {
    return badRequest(res, `Overall budget: ${BAD_AMOUNT}`);
  }

  await saveBudget(req.session.userId, month, current => ({
    total,
    categories: current?.categories ?? []
  }));

  res.json(await monthView(req, month));
}));

/** Adds a category's budget, or changes it. */
budgetsRouter.put('/:month/categories/:category', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (!month || !await requireManage(req, res)) {
    return;
  }

  const category = normaliseBudgetCategory(req.params.category);
  const amount = amountInPaise(req.body?.amount);

  if (!category) {
    return badRequest(res, 'That is not one of the expense categories.');
  }

  if (amount === null) {
    return badRequest(res, `${category}: ${BAD_AMOUNT}`);
  }

  await saveBudget(req.session.userId, month, current => ({
    total: current?.total ?? null,
    categories: [
      ...(current?.categories ?? []).filter(entry => entry.category !== category),
      { category, amount }
    ]
  }));

  res.json(await monthView(req, month));
}));

budgetsRouter.delete('/:month/categories/:category', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (!month || !await requireManage(req, res)) {
    return;
  }

  const category = normaliseBudgetCategory(req.params.category);

  if (!category) {
    return badRequest(res, 'That is not one of the expense categories.');
  }

  await saveBudget(req.session.userId, month, current => current && {
    total: current.total,
    categories: current.categories.filter(entry => entry.category !== category)
  });

  res.json(await monthView(req, month));
}));

/** Removes the month's budget and its alerts. The expenses are untouched. */
budgetsRouter.delete('/:month', asyncRoute(async (req, res) => {
  const month = readMonth(req, res);

  if (!month || !await requireManage(req, res)) {
    return;
  }

  await saveBudget(req.session.userId, month, () => null);

  res.json(await monthView(req, month));
}));
