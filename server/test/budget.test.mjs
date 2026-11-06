/**
 * The budget rules on their own: months, what counts as spending, status,
 * thresholds, alerts and history. No database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVER,
  OVERALL,
  UNCATEGORISED,
  alertMessage,
  buildHistory,
  buildMonthView,
  crossings,
  monthOfDate,
  normaliseBudgetCategory,
  parseMonth,
  percentOf,
  reachedThresholds,
  shiftMonth,
  statusOf,
  summariseSpending,
  worstPerScope
} from '../src/budget.mjs';

const NOW = new Date('2026-11-06T10:00:00Z');

// ----------------------------------------------------------------- months

test('a month key gives the month and its date range', () => {
  assert.deepEqual(parseMonth('2026-11', NOW), {
    key: '2026-11', index: 2026 * 12 + 10, start: '2026-11-01', end: '2026-12-01'
  });
  assert.equal(parseMonth('2026-12', NOW).end, '2027-01-01', 'December runs into January');
});

test('malformed months, the distant past and the far future are refused', () => {
  for (const key of ['2026-13', '2026-1', '26-11', '1999-12', '2028-12', '', null, '2026-11-01']) {
    assert.equal(parseMonth(key, NOW), null, String(key));
  }

  assert.ok(parseMonth('2028-11', NOW), 'two years ahead is allowed');
});

test('a date belongs to the month it falls in, at both ends', () => {
  assert.equal(monthOfDate('2026-10-31').key, '2026-10');
  assert.equal(monthOfDate('2026-11-01').key, '2026-11');
  assert.equal(shiftMonth(parseMonth('2026-01', NOW), -1).key, '2025-12');
});

test('categories are the expense list plus Uncategorised, any case', () => {
  assert.equal(normaliseBudgetCategory('food & drink'), 'Food & Drink');
  assert.equal(normaliseBudgetCategory(' TRAVEL '), 'Travel');
  assert.equal(normaliseBudgetCategory('uncategorised'), UNCATEGORISED);
  assert.equal(normaliseBudgetCategory('other'), 'Other');
  assert.equal(normaliseBudgetCategory('Rent'), null);
  assert.equal(normaliseBudgetCategory("'; drop table users; --"), null);
});

// ------------------------------------------------------------ the spending rule

test('only settled expenses count; pending ones wait', () => {
  const result = summariseSpending([
    { category: 'Travel', status: 'done', spent: 500 },
    { category: 'Travel', status: 'pending', spent: 9000 }
  ]);

  assert.equal(result.total, 50_000);
  assert.equal(result.byCategory.get('Travel'), 50_000);
});

test('a split counts as the share the query already summed, never the bill', () => {
  // The query sums coalesce(personal_share, amount): ₹1,455 split four ways
  // arrives here as ₹363.
  const result = summariseSpending([{ category: 'Groceries', status: 'done', spent: '363.00' }]);

  assert.equal(result.total, 36_300);
});

test('no category is counted as Uncategorised, so the parts add up', () => {
  const result = summariseSpending([
    { category: null, status: 'done', spent: 250 },
    { category: 'Health', status: 'done', spent: 600 }
  ]);

  const parts = [...result.byCategory.values()].reduce((a, b) => a + b, 0);

  assert.equal(result.byCategory.get(UNCATEGORISED), 25_000);
  assert.equal(parts, result.total);
});

test('sums are exact in paise, not floating point', () => {
  const result = summariseSpending([
    { category: 'Travel', status: 'done', spent: '0.10' },
    { category: 'Travel', status: 'done', spent: '0.20' }
  ]);

  assert.equal(result.total, 30, '0.1 + 0.2 is 30 paise, not 30.000000000000004');
});

// ---------------------------------------------------------------- status

test('status bands: under 70% on track, 70% to under 100% near, 100% and over red', () => {
  assert.equal(statusOf(6_999, 10_000), 'on-track', '69.99%');
  assert.equal(statusOf(7_000, 10_000), 'near', '70%');
  assert.equal(statusOf(9_999, 10_000), 'near', '99.99%');
  assert.equal(statusOf(10_000, 10_000), 'over', '100%');
  assert.equal(statusOf(11_700, 10_000), 'over', '117%');
});

test('percentages show two places', () => {
  assert.equal(percentOf(1_850_000, 3_000_000), 61.67);
  assert.equal(percentOf(0, 3_000_000), 0);
});

// ------------------------------------------------------------- thresholds

test('thresholds reached at exactly 50, 80 and 100%, and "over" only past 100%', () => {
  assert.deepEqual(reachedThresholds(4_999, 10_000), []);
  assert.deepEqual(reachedThresholds(5_000, 10_000), [50]);
  assert.deepEqual(reachedThresholds(8_000, 10_000), [50, 80]);
  assert.deepEqual(reachedThresholds(10_000, 10_000), [50, 80, 100]);
  assert.deepEqual(reachedThresholds(10_001, 10_000), [50, 80, 100, OVER]);
});

test('category limits alone raise no overall alert', () => {
  const budget = { total: null, categories: [{ category: 'Travel', amount: 300_000 }] };
  const spending = { total: 350_000, byCategory: new Map([['Travel', 350_000]]) };

  const scopes = new Set(crossings(budget, spending).map(entry => entry.scope));

  assert.deepEqual([...scopes], ['Travel']);
});

test('one big expense crossing several thresholds is announced once, at the worst', () => {
  const crossed = [
    { scope: 'Travel', threshold: 80 },
    { scope: 'Travel', threshold: 100 },
    { scope: 'Travel', threshold: OVER },
    { scope: OVERALL, threshold: 50 }
  ];

  const worst = worstPerScope(crossed);

  assert.deepEqual(worst.map(entry => [entry.scope, entry.threshold]).sort(), [
    ['Travel', OVER],
    [OVERALL, 50]
  ].sort());
});

test('alert sentences', () => {
  assert.equal(
    alertMessage({ scope: 'Travel', threshold: 80, spent: 246_000, budget: 300_000 }),
    'Travel is at 82% of its ₹3,000 budget — ₹540 left.'
  );
  assert.equal(
    alertMessage({ scope: 'Travel', threshold: OVER, spent: 350_000, budget: 300_000 }),
    'Travel is ₹500 over its ₹3,000 budget.'
  );
  assert.equal(
    alertMessage({ scope: OVERALL, threshold: 100, spent: 3_000_000, budget: 3_000_000 }),
    "This month's spending has reached your ₹30,000 budget."
  );
});

// --------------------------------------------------------------- the month view

test('the month view: totals, categories, unbudgeted spending, over count', () => {
  const view = buildMonthView({
    month: parseMonth('2026-11', NOW),
    budget: {
      total: 3_000_000,
      categories: [
        { category: 'Travel', amount: 300_000 },
        { category: 'Food & Drink', amount: 500_000 }
      ]
    },
    spending: {
      total: 1_850_000,
      byCategory: new Map([['Travel', 350_000], ['Food & Drink', 320_000], ['Health', 60_000]])
    },
    canManage: true
  });

  assert.equal(view.total, 30_000);
  assert.equal(view.spent, 18_500);
  assert.equal(view.remaining, 11_500);
  assert.equal(view.percent, 61.67);
  assert.equal(view.status, 'on-track');
  assert.equal(view.overCount, 1);
  assert.equal(view.categories[0].category, 'Travel', 'most used first');
  assert.equal(view.categories[0].remaining, -500);
  assert.deepEqual(view.unbudgeted, [{ category: 'Health', spent: 600 }]);
  assert.equal(view.allocated, 8_000);
});

test('with only category limits, they stand for the month', () => {
  const view = buildMonthView({
    month: parseMonth('2026-11', NOW),
    budget: { total: null, categories: [{ category: 'Travel', amount: 300_000 }] },
    spending: { total: 100_000, byCategory: new Map([['Travel', 100_000]]) }
  });

  assert.equal(view.fromCategories, true);
  assert.equal(view.overall, null);
  assert.equal(view.total, 3_000);
});

test('a month with no budget still reports what was spent', () => {
  const view = buildMonthView({
    month: parseMonth('2026-11', NOW),
    budget: null,
    spending: { total: 25_000, byCategory: new Map([['Travel', 25_000]]) }
  });

  assert.equal(view.exists, false);
  assert.equal(view.total, null);
  assert.equal(view.spent, 250);
  assert.equal(view.canManage, false);
});

// ----------------------------------------------------------------- history

test('history: overspend, comparison and the categories often over', () => {
  const end = parseMonth('2026-11', NOW);
  const months = [-3, -2, -1, 0].map(delta => shiftMonth(end, delta));

  const travel = amount => ({ total: 1_000_000, categories: [{ category: 'Travel', amount }] });
  const spent = (total, travelSpent) => ({ total, byCategory: new Map([['Travel', travelSpent]]) });

  const history = buildHistory({
    months,
    budgets: new Map([
      ['2026-08', travel(100_000)],
      ['2026-09', travel(100_000)],
      ['2026-10', travel(100_000)]
    ]),
    spending: new Map([
      ['2026-08', spent(1_200_000, 150_000)],
      ['2026-09', spent(800_000, 50_000)],
      ['2026-10', spent(900_000, 120_000)],
      ['2026-11', spent(400_000, 0)]
    ])
  });

  assert.equal(history.months.length, 4);
  assert.equal(history.months[3].total, null, 'November has no budget');
  assert.equal(history.months[3].spent, 4_000, 'but its spending still shows');
  assert.equal(history.totalOverspend, 2_000, 'only August went over, by ₹2,000');
  assert.deepEqual(history.comparison, {
    month: '2026-11', previousMonth: '2026-10', spent: 4_000, previousSpent: 9_000, difference: -5_000
  });
  assert.deepEqual(history.oftenOver, [{ category: 'Travel', overMonths: 2, budgetedMonths: 3 }]);
});
