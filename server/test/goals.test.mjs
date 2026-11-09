/**
 * Savings goal arithmetic and input checks, with no database: whole-paise
 * amounts, months left, the monthly amount needed, status labels and
 * validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_MAX_PAISE,
  TARGET_MAX_PAISE,
  goalView,
  monthsLeft,
  readEntry,
  readGoal,
  rupeesToPaise
} from '../src/goals.mjs';

const TODAY = '2026-11-06';

const goal = extra => ({
  target_paise: 15_000_000, saved_paise: 9_200_000, target_date: '2027-03-31',
  status: 'active', created_on: '2026-09-01', ...extra
});

test('rupees become whole paise without floating-point error', () => {
  assert.equal(rupeesToPaise('0.10', TARGET_MAX_PAISE), 10);
  assert.equal(rupeesToPaise(0.1, TARGET_MAX_PAISE), 10);
  assert.equal(rupeesToPaise('1499.99', TARGET_MAX_PAISE), 149_999);
  assert.equal(rupeesToPaise(150000, TARGET_MAX_PAISE), 15_000_000);
  assert.equal(rupeesToPaise('999999999999.99', TARGET_MAX_PAISE), null);
  assert.equal(rupeesToPaise('9999999999.99', TARGET_MAX_PAISE), TARGET_MAX_PAISE);
});

test('anything that is not a positive amount with at most two decimals is refused', () => {
  for (const bad of [0, -1, '0', '-5', '1.234', 1.005, 'abc', '', null, undefined, true, [5], '1e5', NaN, Infinity]) {
    assert.equal(rupeesToPaise(bad, TARGET_MAX_PAISE), null, String(bad));
  }
});

test('months left are whole months rounded up, at least one, zero once passed', () => {
  assert.equal(monthsLeft(TODAY, '2027-03-31'), 5);
  assert.equal(monthsLeft(TODAY, '2026-12-20'), 2);
  assert.equal(monthsLeft(TODAY, '2026-12-06'), 1);
  assert.equal(monthsLeft(TODAY, '2026-11-06'), 1);
  assert.equal(monthsLeft(TODAY, '2026-11-30'), 1);
  assert.equal(monthsLeft(TODAY, '2027-06-30'), 8);
  assert.equal(monthsLeft(TODAY, '2026-11-05'), 0);
  assert.equal(monthsLeft('2026-12-31', '2027-02-28'), 2);
  assert.equal(monthsLeft('2028-01-31', '2028-02-29'), 1);
});

test('the monthly amount is what is left over the months left, rounded up to the paisa', () => {
  const v = goalView(goal(), TODAY);
  assert.equal(v.remainingPaise, 5_800_000);
  assert.equal(v.monthlyPaise, 1_160_000);
  assert.equal(v.percent, 61);

  // ₹100 over 3 months: 3333.34 paise each, rounded up, never short.
  assert.equal(goalView(goal({ target_paise: 10_000, saved_paise: 0, target_date: '2027-02-06' }), TODAY).monthlyPaise, 3_334);
});

test('states: on track, behind, date passed, reached, paused, completed', () => {
  // Two months in of seven, 61% saved: on track.
  assert.equal(goalView(goal(), TODAY).state, 'on-track');
  // Two months in of seven, 10% saved: behind.
  assert.equal(goalView(goal({ saved_paise: 1_500_000 }), TODAY).state, 'behind');
  assert.equal(goalView(goal({ target_date: '2026-11-01' }), TODAY).state, 'date-passed');
  assert.equal(goalView(goal({ target_date: '2026-11-01' }), TODAY).monthlyPaise, null);
  assert.equal(goalView(goal({ saved_paise: 15_000_000 }), TODAY).state, 'reached');
  assert.equal(goalView(goal({ status: 'paused' }), TODAY).state, 'paused');
  assert.equal(goalView(goal({ status: 'completed' }), TODAY).state, 'completed');
  assert.equal(goalView(goal({ status: 'completed' }), TODAY).monthlyPaise, null);
});

test('saving past the target shows how far over, and never more than 100% as short', () => {
  const v = goalView(goal({ saved_paise: 16_000_000 }), TODAY);
  assert.equal(v.overPaise, 1_000_000);
  assert.equal(v.remainingPaise, 0);
  assert.equal(v.percent, 106);
  assert.equal(goalView(goal({ saved_paise: 14_999_999 }), TODAY).percent, 99);
});

const body = extra => ({ name: 'Goa trip', target: 40000, targetDate: '2026-12-20', icon: 'travel', ...extra });

test('a valid goal is read with paise and clean values', () => {
  assert.deepEqual(readGoal(body({ initialSaved: '20000.50' }), { today: TODAY, creating: true }).value, {
    name: 'Goa trip', description: null, icon: 'travel', targetPaise: 4_000_000,
    targetDate: '2026-12-20', initialPaise: 2_000_050
  });
});

test('bad goals are refused', () => {
  const bad = [
    { name: '' }, { name: 'x'.repeat(81) }, { description: 'x'.repeat(301) }, { icon: 'rocket' },
    { target: 0 }, { target: '-1' }, { target: '1000000000000' }, { targetDate: 'soon' },
    { targetDate: '2026-11-05' }, { targetDate: '2080-01-01' }, { initialSaved: '-5' }, { initialSaved: 10_000_001 }
  ];

  for (const extra of bad) {
    assert.ok(readGoal(body(extra), { today: TODAY, creating: true }).error, JSON.stringify(extra));
  }
});

test('an edit may keep a target date that has passed, but not move to another past date', () => {
  const opts = { today: TODAY, creating: false, currentDate: '2026-11-01' };
  assert.ok(readGoal(body({ targetDate: '2026-11-01' }), opts).value);
  assert.ok(readGoal(body({ targetDate: '2026-10-01' }), opts).error);
  assert.equal(readGoal(body({ initialSaved: 500 }), opts).value.initialPaise, 0, 'only creating reads it');
});

test('entries: an amount, a date no later than today, an optional note', () => {
  assert.deepEqual(readEntry({ amount: '11600', note: ' November salary ' }, { today: TODAY }).value,
    { amountPaise: 1_160_000, onDate: TODAY, note: 'November salary' });
  assert.equal(readEntry({ amount: 1, date: '2026-10-05' }, { today: TODAY }).value.onDate, '2026-10-05');
  assert.equal(readEntry({ amount: 10_000_000 }, { today: TODAY }).value.amountPaise, ENTRY_MAX_PAISE);

  for (const bad of [{ amount: 0 }, { amount: 10_000_000.01 }, { amount: 5, date: '2026-11-07' }, { amount: 5, note: 'x'.repeat(201) }]) {
    assert.ok(readEntry(bad, { today: TODAY }).error, JSON.stringify(bad));
  }
});
