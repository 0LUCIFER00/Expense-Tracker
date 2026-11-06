/**
 * Monthly budgets: the rules, with no database in sight.
 *
 * Everything that decides a figure lives here so it can be tested on its own:
 * which month a date belongs to, what counts as spending, how a budget's status
 * and alerts are worked out. Money is handled in integer paise throughout; the
 * conversion to rupees happens once, at the edge, when a response is built.
 */
import { CATEGORIES } from './categories.mjs';

/** Where an expense with no category is counted, and how it is budgeted. */
export const UNCATEGORISED = 'Uncategorised';

/** What a category budget may be set for: the expense categories, plus the rest. */
export const BUDGET_CATEGORIES = [...CATEGORIES, UNCATEGORISED];

/** The largest budget for one month or one category: ₹99,99,99,999.99. */
export const BUDGET_MAX = 999_999_999.99;

/** 50, 80 and 100 per cent of a budget, and 101 for "over it". */
export const THRESHOLDS = [50, 80, 100, 101];
export const OVER = 101;

/** The scope an overall alert is recorded under; categories use their name. */
export const OVERALL = 'overall';

/** How far ahead a budget may be planned. */
const MONTHS_AHEAD = 24;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

/** A month from its count of months since year 0, with its date range. */
function monthAt(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const next = index + 1;
  const key = `${year}-${pad(month)}`;

  return {
    key,
    index,
    // The first day of the month, and of the next: [start, end).
    start: `${key}-01`,
    end: `${Math.floor(next / 12)}-${pad((next % 12) + 1)}-01`
  };
}

/**
 * Reads "YYYY-MM", or returns null.
 *
 * From January 2000 to two years ahead: far enough back for any history, far
 * enough forward to plan, and no further, so a typo cannot create a budget for
 * the year 9999.
 */
export function parseMonth(key, now = new Date()) {
  const match = MONTH_KEY.exec(String(key ?? ''));

  if (!match) {
    return null;
  }

  const index = Number(match[1]) * 12 + Number(match[2]) - 1;
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();

  if (Number(match[1]) < 2000 || index > current + MONTHS_AHEAD) {
    return null;
  }

  return monthAt(index);
}

/** The month a YYYY-MM-DD date falls in. */
export function monthOfDate(date) {
  const [year, month] = String(date).slice(0, 7).split('-').map(Number);
  return monthAt(year * 12 + month - 1);
}

/** The month `delta` months before (negative) or after this one. */
export function shiftMonth(month, delta) {
  return monthAt(month.index + delta);
}

/** Rupees, as the database returns them, to integer paise. */
export function toPaise(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function toRupees(paise) {
  return paise / 100;
}

/** A category name as the list spells it, or null when it is not one. */
export function normaliseBudgetCategory(value) {
  const text = String(value ?? '').trim().toLowerCase();

  return BUDGET_CATEGORIES.find(name => name.toLowerCase() === text) ?? null;
}

/**
 * What was spent, from rows grouped by (category, status).
 *
 * The same rule the rest of the app uses: only settled expenses count, and each
 * row's figure is already the owner's share of a split (personal_share, else
 * amount). Repayments are income and never reach this function, so they cannot
 * lower spending or pass for it. An expense with no category still counts,
 * under Uncategorised, so the parts add up to the whole.
 *
 * @param rows [{ category, status, spent }]
 * @returns { total, byCategory } in paise
 */
export function summariseSpending(rows) {
  let total = 0;
  const byCategory = new Map();

  for (const row of rows) {
    if (row.status !== 'done') {
      continue;
    }

    const paise = toPaise(row.spent);
    const category = row.category ?? UNCATEGORISED;

    total += paise;
    byCategory.set(category, (byCategory.get(category) ?? 0) + paise);
  }

  return { total, byCategory };
}

/**
 * Green under 70%, orange from 70% to just under 100%, red at 100% and over.
 * Compared in whole paise, so 69.99% is never rounded into orange.
 */
export function statusOf(spent, budget) {
  if (spent >= budget) {
    return 'over';
  }

  return spent * 100 >= budget * 70 ? 'near' : 'on-track';
}

/** Per cent used, to two places, for display. */
export function percentOf(spent, budget) {
  return Math.round((spent * 10_000) / budget) / 100;
}

/** The thresholds this much spending has reached against this budget. */
export function reachedThresholds(spent, budget) {
  return THRESHOLDS.filter(threshold =>
    threshold === OVER ? spent > budget : spent * 100 >= budget * threshold
  );
}

/** One budget line, in rupees, as a response carries it. */
function line(budget, spent) {
  return {
    budget: toRupees(budget),
    spent: toRupees(spent),
    remaining: toRupees(budget - spent),
    percent: percentOf(spent, budget),
    status: statusOf(spent, budget)
  };
}

/**
 * The month as the Budgets page and Home show it.
 *
 * @param budget   { total, categories: [{ category, amount }] } in paise, or null
 * @param spending summariseSpending's result
 * @param alerts   rows from budget_alerts
 */
export function buildMonthView({ month, budget, spending, alerts = [], canManage }) {
  const categories = (budget?.categories ?? [])
    .map(entry => ({
      category: entry.category,
      ...line(entry.amount, spending.byCategory.get(entry.category) ?? 0)
    }))
    .sort((a, b) => b.percent - a.percent || a.category.localeCompare(b.category));

  const allocated = (budget?.categories ?? []).reduce((sum, entry) => sum + entry.amount, 0);
  const budgeted = new Set((budget?.categories ?? []).map(entry => entry.category));

  // Spending in categories with no budget, so the page can account for it.
  const unbudgeted = [...spending.byCategory]
    .filter(([category, spent]) => !budgeted.has(category) && spent > 0)
    .map(([category, spent]) => ({ category, spent: toRupees(spent) }))
    .sort((a, b) => b.spent - a.spent);

  // With no overall figure, the category limits together stand for the month.
  const total = budget?.total ?? (allocated > 0 ? allocated : null);

  return {
    month: month.key,
    exists: Boolean(budget),
    overall: budget?.total != null ? toRupees(budget.total) : null,
    fromCategories: budget?.total == null && allocated > 0,
    total: total === null ? null : toRupees(total),
    spent: toRupees(spending.total),
    remaining: total === null ? null : toRupees(total - spending.total),
    percent: total === null ? null : percentOf(spending.total, total),
    status: total === null ? null : statusOf(spending.total, total),
    allocated: toRupees(allocated),
    overCount: categories.filter(entry => entry.status === 'over' && entry.spent > entry.budget).length,
    categories,
    unbudgeted,
    alerts: alerts.map(alert => ({
      scope: alert.scope,
      threshold: alert.threshold,
      spent: Number(alert.spent),
      at: alert.created_at
    })),
    canManage: Boolean(canManage)
  };
}

/**
 * Which thresholds a month's spending has reached, scope by scope.
 *
 * The overall budget only alerts when one is set; category limits standing in
 * for it do not raise a second, overall alert on top of their own.
 *
 * @returns [{ scope, threshold, spent, budget }] in paise
 */
export function crossings(budget, spending) {
  const found = [];

  const add = (scope, spent, amount) => {
    for (const threshold of reachedThresholds(spent, amount)) {
      found.push({ scope, threshold, spent, budget: amount });
    }
  };

  if (budget.total != null) {
    add(OVERALL, spending.total, budget.total);
  }

  for (const entry of budget.categories) {
    add(entry.category, spending.byCategory.get(entry.category) ?? 0, entry.amount);
  }

  return found;
}

/**
 * Of the thresholds just crossed, the one worth telling: the highest per scope.
 * One expense taking Travel from 60% to 120% crossed 80, 100 and "over" at once,
 * and only "over" needs saying.
 */
export function worstPerScope(crossed) {
  const worst = new Map();

  for (const entry of crossed) {
    if (!worst.has(entry.scope) || worst.get(entry.scope).threshold < entry.threshold) {
      worst.set(entry.scope, entry);
    }
  }

  return [...worst.values()];
}

function rupees(paise) {
  return `₹${toRupees(paise).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** The sentence an alert is shown as, on the website and on WhatsApp. */
export function alertMessage({ scope, threshold, spent, budget }) {
  const overall = scope === OVERALL;

  if (threshold === OVER) {
    return overall
      ? `This month's spending is ${rupees(spent - budget)} over your ${rupees(budget)} budget.`
      : `${scope} is ${rupees(spent - budget)} over its ${rupees(budget)} budget.`;
  }

  if (threshold === 100) {
    return overall
      ? `This month's spending has reached your ${rupees(budget)} budget.`
      : `${scope} has reached its ${rupees(budget)} budget.`;
  }

  const left = rupees(budget - spent);
  const percent = Math.floor(percentOf(spent, budget));

  return overall
    ? `This month's spending is at ${percent}% of your ${rupees(budget)} budget — ${left} left.`
    : `${scope} is at ${percent}% of its ${rupees(budget)} budget — ${left} left.`;
}

/**
 * Several months side by side, for the history section.
 *
 * @param months   month objects, oldest first
 * @param budgets  Map of month key → budget (paise) for the months that have one
 * @param spending Map of month key → summariseSpending result
 */
export function buildHistory({ months, budgets, spending }) {
  const empty = { total: 0, byCategory: new Map() };

  const rows = months.map(month => {
    const budget = budgets.get(month.key) ?? null;
    const spent = spending.get(month.key) ?? empty;
    const allocated = (budget?.categories ?? []).reduce((sum, entry) => sum + entry.amount, 0);
    const total = budget ? budget.total ?? (allocated > 0 ? allocated : null) : null;

    return {
      month: month.key,
      total: total === null ? null : toRupees(total),
      spent: toRupees(spent.total),
      percent: total === null ? null : percentOf(spent.total, total),
      status: total === null ? null : statusOf(spent.total, total),
      over: total === null ? 0 : toRupees(Math.max(0, spent.total - total)),
      categories: (budget?.categories ?? []).map(entry => ({
        category: entry.category,
        ...line(entry.amount, spent.byCategory.get(entry.category) ?? 0)
      })),
      _overPaise: total === null ? 0 : Math.max(0, spent.total - total),
      _spentPaise: spent.total
    };
  });

  // A category is "often over" when it went over in at least two of the months
  // it had a budget, and in at least half of them.
  const tally = new Map();

  for (const row of rows) {
    for (const entry of row.categories) {
      const counts = tally.get(entry.category) ?? { overMonths: 0, budgetedMonths: 0 };

      counts.budgetedMonths += 1;
      counts.overMonths += entry.spent > entry.budget ? 1 : 0;
      tally.set(entry.category, counts);
    }
  }

  const oftenOver = [...tally]
    .filter(([, counts]) => counts.overMonths >= 2 && counts.overMonths * 2 >= counts.budgetedMonths)
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((a, b) => b.overMonths - a.overMonths || a.category.localeCompare(b.category));

  const last = rows.at(-1);
  const previous = rows.at(-2);

  const comparison = last && previous
    ? {
        month: last.month,
        previousMonth: previous.month,
        spent: last.spent,
        previousSpent: previous.spent,
        difference: toRupees(last._spentPaise - previous._spentPaise)
      }
    : null;

  const totalOverspend = toRupees(rows.reduce((sum, row) => sum + row._overPaise, 0));

  return {
    months: rows.map(({ _overPaise, _spentPaise, ...row }) => row),
    comparison,
    totalOverspend,
    oftenOver
  };
}
