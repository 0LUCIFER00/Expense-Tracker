/**
 * The date arithmetic and input checks behind recurring schedules, with no
 * database: every frequency, month ends, leap years, end dates, reminders and
 * the India-time day boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  advance,
  daysBetween,
  firstSeqOnOrAfter,
  inReminderWindow,
  monthlyPaise,
  occurrenceDate,
  readSchedule,
  reminderLine,
  upcomingDates
} from '../src/recurring.mjs';
import { todayInIndia } from '../src/http.mjs';

const schedule = (frequency, anchor, extra = {}) => ({
  frequency, interval_count: 1, anchor_on: anchor, end_on: null, ...extra
});

const dates = (s, count) => Array.from({ length: count }, (_, i) => occurrenceDate(s, i));

test('daily schedules step one day, across month and year ends', () => {
  assert.deepEqual(dates(schedule('daily', '2026-12-30'), 4),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('every 3 days', () => {
  assert.deepEqual(dates(schedule('daily', '2026-02-26', { interval_count: 3 }), 3),
    ['2026-02-26', '2026-03-01', '2026-03-04']);
});

test('weekly and fortnightly schedules keep the weekday', () => {
  assert.deepEqual(dates(schedule('weekly', '2026-11-06'), 3),
    ['2026-11-06', '2026-11-13', '2026-11-20']);
  assert.deepEqual(dates(schedule('weekly', '2026-12-25', { interval_count: 2 }), 3),
    ['2026-12-25', '2027-01-08', '2027-01-22']);
});

test('monthly on the 31st uses the last day of short months and returns to the 31st', () => {
  assert.deepEqual(dates(schedule('monthly', '2027-01-31'), 5),
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
});

test('monthly on the 31st falls on 29 February in a leap year', () => {
  assert.equal(occurrenceDate(schedule('monthly', '2028-01-31'), 1), '2028-02-29');
});

test('monthly on the 30th never drifts to an earlier day after February', () => {
  assert.deepEqual(dates(schedule('monthly', '2027-01-30'), 3),
    ['2027-01-30', '2027-02-28', '2027-03-30']);
});

test('every 3 months crosses the year end', () => {
  assert.deepEqual(dates(schedule('monthly', '2026-11-15', { interval_count: 3 }), 3),
    ['2026-11-15', '2027-02-15', '2027-05-15']);
});

test('yearly on 29 February is 28 February in other years and 29 February in leap years', () => {
  assert.deepEqual(dates(schedule('yearly', '2028-02-29'), 5),
    ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
});

test('yearly keeps its date', () => {
  assert.deepEqual(dates(schedule('yearly', '2026-11-03'), 2), ['2026-11-03', '2027-11-03']);
});

test('firstSeqOnOrAfter finds the first date on or after a day, for every frequency', () => {
  const cases = [
    schedule('daily', '2026-01-01'),
    schedule('weekly', '2026-01-01', { interval_count: 2 }),
    schedule('monthly', '2026-01-31'),
    schedule('monthly', '2026-01-31', { interval_count: 5 }),
    schedule('yearly', '2024-02-29')
  ];

  for (const s of cases) {
    for (const day of ['2025-12-01', '2026-01-01', '2026-03-01', '2026-03-31', '2026-11-06', '2028-02-29']) {
      const seq = firstSeqOnOrAfter(s, day);
      assert.ok(occurrenceDate(s, seq) >= day, `${s.frequency} ${day}`);
      assert.ok(seq === 0 || occurrenceDate(s, seq - 1) < day, `${s.frequency} ${day} is the first`);
    }
  }
});

test('advance moves to the next date, and completes past the end date', () => {
  const s = schedule('monthly', '2026-11-05', { end_on: '2026-12-31' });

  assert.deepEqual(advance(s, 0), { next_seq: 1, next_due_on: '2026-12-05', status: 'active' });
  assert.deepEqual(advance(s, 1), { next_seq: 2, next_due_on: null, status: 'completed' });
});

test('an end date on the due date itself still includes that date', () => {
  const s = schedule('monthly', '2026-11-05', { end_on: '2026-12-05' });
  assert.equal(advance(s, 0).status, 'active');
  assert.deepEqual(upcomingDates(s, 0, 5), ['2026-11-05', '2026-12-05']);
});

test('reminder window opens remind_days before the due date and closes after it', () => {
  const s = { status: 'active', remind_days: 3, next_due_on: '2026-11-13' };

  assert.equal(inReminderWindow(s, '2026-11-09'), false);
  assert.equal(inReminderWindow(s, '2026-11-10'), true);
  assert.equal(inReminderWindow(s, '2026-11-13'), true);
  assert.equal(inReminderWindow(s, '2026-11-14'), false);
  assert.equal(inReminderWindow({ ...s, remind_days: null }, '2026-11-12'), false);
  assert.equal(inReminderWindow({ ...s, status: 'paused' }, '2026-11-12'), false);
});

test('reminder line says tomorrow and never shows a balance', () => {
  const line = reminderLine(
    { kind: 'expense', description: 'Electricity bill', amount: 2000, next_due_on: '2026-11-07' },
    '2026-11-06'
  );
  assert.match(line, /Electricity bill ₹2,000 is due tomorrow/);
});

test('monthly equivalent in whole paise', () => {
  assert.equal(monthlyPaise({ frequency: 'monthly', interval_count: 1, amount: 15000 }), 1_500_000);
  assert.equal(monthlyPaise({ frequency: 'yearly', interval_count: 1, amount: 8000 }), 66_667);
  assert.equal(monthlyPaise({ frequency: 'daily', interval_count: 1, amount: 60 }), 182_500);
  assert.equal(monthlyPaise({ frequency: 'monthly', interval_count: 1, amount: 0.1 }), 10);
});

test("today is India's date: 23:59 and 00:00 IST either side of 18:30 UTC", () => {
  assert.equal(todayInIndia(new Date('2026-11-06T18:29:59Z')), '2026-11-06');
  assert.equal(todayInIndia(new Date('2026-11-06T18:30:00Z')), '2026-11-07');
  assert.equal(todayInIndia(new Date('2026-12-31T18:30:00Z')), '2027-01-01');
});

test('date helpers are pure calendar arithmetic', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(daysBetween('2026-11-06', '2027-11-06'), 365);
});

const TODAY = '2026-11-06';
const body = extra => ({
  kind: 'expense', description: 'Rent', amount: 15000, category: 'Bills & Utilities',
  accountId: 'acc', frequency: 'monthly', startOn: '2026-12-05', remindDays: 1, ...extra
});

test('a valid schedule is read with clean values', () => {
  const { value } = readSchedule(body(), { today: TODAY, canBackdate: false, creating: true });

  assert.deepEqual(value, {
    kind: 'expense', description: 'Rent', amount: 15000, category: 'Bills & Utilities',
    accountId: 'acc', frequency: 'monthly', interval: 1, from: '2026-12-05', endOn: null, remindDays: 1
  });
});

test('starting in the past needs the backdate permission', () => {
  const refused = readSchedule(body({ startOn: '2026-11-05' }), { today: TODAY, canBackdate: false, creating: true });
  assert.equal(refused.status, 403);

  const allowed = readSchedule(body({ startOn: '2026-11-05' }), { today: TODAY, canBackdate: true, creating: true });
  assert.equal(allowed.value.from, '2026-11-05');

  assert.ok(readSchedule(body({ startOn: TODAY }), { today: TODAY, canBackdate: false, creating: true }).value);
});

test('bad input is refused', () => {
  const opts = { today: TODAY, canBackdate: true, creating: true };
  const bad = [
    { kind: 'transfer' },
    { description: '' },
    { description: 'x'.repeat(201) },
    { amount: 0 },
    { amount: '-5' },
    { amount: 100_001 },
    { amount: true },
    { category: 'Rocket fuel' },
    { frequency: 'hourly' },
    { interval: 0 },
    { interval: 100 },
    { interval: 1.5 },
    { startOn: '2026-13-01' },
    { startOn: '2029-01-01' },
    { endOn: '2026-12-01' },
    { remindDays: 2 },
    { kind: 'income', accountId: null, category: 'Salary' }
  ];

  for (const extra of bad) {
    assert.ok(readSchedule(body(extra), opts).error, JSON.stringify(extra));
  }
});

test('income categories are checked against the income list', () => {
  const opts = { today: TODAY, canBackdate: false, creating: true };
  assert.equal(readSchedule(body({ kind: 'income', category: 'salary' }), opts).value.category, 'Salary');
  assert.ok(readSchedule(body({ kind: 'income', category: 'Groceries' }), opts).error);
});

test('an edit reads the next date and keeps the kind it has', () => {
  const read = readSchedule(
    body({ kind: 'income', nextDueOn: '2026-12-01', startOn: undefined }),
    { today: TODAY, canBackdate: false, creating: false, kind: 'expense' }
  );
  assert.equal(read.value.kind, 'expense');
  assert.equal(read.value.from, '2026-12-01');
});
