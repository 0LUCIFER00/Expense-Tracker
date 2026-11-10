/**
 * Lending and borrowing arithmetic and input checks, with no database:
 * simple interest by the day, never compounded; interest paid before
 * principal; statuses; and what a request may contain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween,
  interestLabel,
  loanStatus,
  readInterest,
  readLoan,
  readRate,
  readRepayment,
  splitRepayment,
  standing
} from '../src/loans.mjs';

const ACCOUNT = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ = '0ddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TODAY = '2026-11-10';

const loan = (extra = {}) => ({
  principal_paise: 1_000_000, // ₹10,000
  start_date: '2025-01-01',
  interest_type: 'none',
  interest_rate_bp: null,
  interest_period: null,
  status: 'active',
  due_date: null,
  ...extra
});

const yearly12 = extra => loan({ interest_type: 'simple', interest_rate_bp: 1200, interest_period: 'year', ...extra });
const paid = (paid_on, principal, interest) => ({ paid_on, principal_paise: principal, interest_paise: interest });

test('days between two dates, never negative', () => {
  assert.equal(daysBetween('2025-01-01', '2026-01-01'), 365);
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
  assert.equal(daysBetween('2025-03-30', '2025-03-31'), 1);
  assert.equal(daysBetween('2025-03-31', '2025-03-30'), 0);
});

test('rates are percentages with at most two decimals, above 0 and up to 100', () => {
  assert.equal(readRate('1.5'), 150);
  assert.equal(readRate(12), 1200);
  assert.equal(readRate('0.01'), 1);
  assert.equal(readRate('100'), 10_000);
  for (const bad of ['0', '100.01', '1.005', '-1', 'two', '', null]) {
    assert.equal(readRate(bad), null, String(bad));
  }
});

test('no interest: only principal is owed, whatever the time', () => {
  const s = standing(loan(), [], TODAY);
  assert.deepEqual(s, {
    principalOutstanding: 1_000_000, principalRepaid: 0, interestAccrued: 0,
    interestPaid: 0, interestOutstanding: 0, outstanding: 1_000_000
  });
});

test('simple yearly interest runs by the day: 12% on ₹10,000 for a year is ₹1,200', () => {
  assert.equal(standing(yearly12(), [], '2026-01-01').interestAccrued, 120_000);
  // 73 days is a fifth of the year.
  assert.equal(standing(yearly12(), [], '2025-03-15').interestAccrued, 24_000);
});

test('a monthly rate counts twelve times a year: 1% a month for 30 days on ₹10,000 is ₹98.63', () => {
  const monthly = loan({ interest_type: 'simple', interest_rate_bp: 100, interest_period: 'month' });
  // 10,000 × 1% × 12 × 30 / 365 = 98.630…
  assert.equal(standing(monthly, [], '2025-01-31').interestAccrued, 9_863);
});

test('never compounded: two years at 12% is ₹2,400, not ₹2,544', () => {
  assert.equal(standing(yearly12(), [], '2027-01-01').interestAccrued, 240_000);
});

test('interest is paid first, then principal, and later interest runs on what is left', () => {
  const l = yearly12();
  // After 73 days ₹240 of interest is due. ₹5,240 pays it and ₹5,000 of principal.
  const first = splitRepayment(l, [], '2025-03-15', 524_000);
  assert.deepEqual([first.interest, first.principal], [24_000, 500_000]);

  // Another 73 days on the ₹5,000 left: ₹120 more.
  const s = standing(l, [paid('2025-03-15', 500_000, 24_000)], '2025-05-27');
  assert.equal(s.interestAccrued, 36_000);
  assert.equal(s.interestPaid, 24_000);
  assert.equal(s.interestOutstanding, 12_000);
  assert.equal(s.principalOutstanding, 500_000);
  assert.equal(s.outstanding, 512_000);
});

test('a repayment smaller than the interest due pays interest only', () => {
  const split = splitRepayment(yearly12(), [], '2025-03-15', 10_000);
  assert.deepEqual([split.interest, split.principal], [10_000, 0]);
});

test('paying everything stops interest: nothing more builds up afterwards', () => {
  const l = yearly12();
  const all = splitRepayment(l, [], '2025-03-15', 1_024_000);
  assert.deepEqual([all.interest, all.principal], [24_000, 1_000_000]);

  const later = standing(l, [paid('2025-03-15', 1_000_000, 24_000)], '2026-11-10');
  assert.equal(later.outstanding, 0);
  assert.equal(later.interestAccrued, 24_000);
});

test('more than is owed, or anything once fully repaid, is refused', () => {
  const l = yearly12();
  assert.equal(splitRepayment(l, [], '2025-03-15', 1_024_001).error, 'too-much');
  assert.equal(splitRepayment(loan(), [paid('2025-02-01', 1_000_000, 0)], '2025-03-01', 1).error, 'nothing-owed');
});

test('rounded once over the whole period, so many small repayments do not drift', () => {
  const l = loan({ principal_paise: 100_001, interest_type: 'simple', interest_rate_bp: 1, interest_period: 'year' });
  const daily = [];
  for (let day = 2; day <= 28; day += 1) {
    daily.push(paid(`2025-01-${String(day).padStart(2, '0')}`, 0, 0));
  }
  assert.equal(standing(l, daily, '2025-01-28').interestAccrued, standing(l, [], '2025-01-28').interestAccrued);
});

test('statuses: cancelled, completed, overdue, partly paid and active', () => {
  const open = { outstanding: 5 };
  assert.equal(loanStatus({ status: 'cancelled' }, open, 0, TODAY), 'cancelled');
  assert.equal(loanStatus({ status: 'active' }, { outstanding: 0 }, 2, TODAY), 'completed');
  assert.equal(loanStatus({ status: 'active', due_date: '2026-11-09' }, open, 1, TODAY), 'overdue');
  assert.equal(loanStatus({ status: 'active', due_date: TODAY }, open, 1, TODAY), 'partial');
  assert.equal(loanStatus({ status: 'active', due_date: null }, open, 0, TODAY), 'active');
});

test('the interest line', () => {
  assert.equal(interestLabel(loan()), 'No interest');
  assert.equal(interestLabel(yearly12({ interest_rate_bp: 150, interest_period: 'month' })), '1.5% a month, simple');
});

test('interest settings: none, or simple with a rate and a period', () => {
  assert.deepEqual(readInterest(undefined).value, { type: 'none', rateBp: null, period: null });
  assert.deepEqual(readInterest({ type: 'simple', rate: '2', period: 'month' }).value, { type: 'simple', rateBp: 200, period: 'month' });
  assert.ok(readInterest({ type: 'compound', rate: 2, period: 'month' }).error, 'compound is never offered');
  assert.ok(readInterest({ type: 'simple', rate: 2, period: 'week' }).error);
  assert.ok(readInterest({ type: 'simple', rate: 0, period: 'year' }).error);
});

const body = extra => ({
  direction: 'lent', personName: ' Asha ', amount: '2500.50', date: TODAY, accountId: ACCOUNT, requestId: REQ, ...extra
});

test('a new record: trimmed name, principal in paise, defaults for the optional parts', () => {
  const { value } = readLoan(body(), { today: TODAY, canBackdate: false, creating: true });
  assert.deepEqual(value, {
    direction: 'lent', accountId: ACCOUNT, requestId: REQ, personName: 'Asha', contact: null,
    principalPaise: 250_050, date: TODAY, dueDate: null,
    interest: { type: 'none', rateBp: null, period: null }, notes: null
  });
});

test('a new record is refused for anything it cannot be', () => {
  const opts = { today: TODAY, canBackdate: true, creating: true };
  const cases = [
    body({ direction: 'gift' }), body({ personName: '' }), body({ personName: 'x'.repeat(81) }),
    body({ amount: 0 }), body({ amount: '1.005' }), body({ amount: -5 }), body({ amount: '1e3' }),
    body({ accountId: 'not-an-id' }), body({ date: '2026-11-11' }), body({ date: 'soon' }),
    body({ dueDate: '2026-11-01', date: '2026-11-05' }), body({ requestId: 'again' }),
    body({ interest: { type: 'simple', rate: '200', period: 'month' } }), body({ notes: 'n'.repeat(301) })
  ];
  for (const c of cases) {
    assert.ok(readLoan(c, opts).error, JSON.stringify(c));
  }
});

test('an earlier date needs "Change transaction dates"; keeping an existing one does not', () => {
  const backdated = body({ date: '2026-01-01' });
  const refused = readLoan(backdated, { today: TODAY, canBackdate: false, creating: true });
  assert.equal(refused.status, 403);
  assert.ok(readLoan(backdated, { today: TODAY, canBackdate: true, creating: true }).value);
  assert.ok(readLoan(backdated, { today: TODAY, canBackdate: false, creating: false, currentDate: '2026-01-01' }).value);
});

test('a repayment: amount, account, date and note', () => {
  const ok = readRepayment({ amount: 500, accountId: ACCOUNT, note: ' cash ', requestId: REQ }, { today: TODAY, canBackdate: false });
  assert.deepEqual(ok.value, { amountPaise: 50_000, accountId: ACCOUNT, date: TODAY, note: 'cash', requestId: REQ });

  for (const bad of [{ amount: 0, accountId: ACCOUNT }, { amount: 5 }, { amount: 5, accountId: ACCOUNT, date: '2027-01-01' }]) {
    assert.ok(readRepayment(bad, { today: TODAY, canBackdate: true }).error, JSON.stringify(bad));
  }
  assert.equal(readRepayment({ amount: 5, accountId: ACCOUNT, date: '2026-11-01' }, { today: TODAY, canBackdate: false }).status, 403);
});
