/**
 * Account transfer input checks, with no database: accounts, amounts in whole
 * paise, the date rules and the description.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { money, readTransfer } from '../src/transfers.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const TODAY = '2026-11-09';

const body = extra => ({ fromAccountId: A, toAccountId: B, amount: '1500.50', requestId: REQ, ...extra });
const read = (extra, canBackdate = false) => readTransfer(body(extra), { today: TODAY, canBackdate });

test('a valid transfer is read in whole paise, dated today by default', () => {
  assert.deepEqual(read({ description: '  Top up  ' }).value, {
    fromId: A, toId: B, amountPaise: 150_050, date: TODAY, description: 'Top up', requestId: REQ
  });
  assert.equal(read({ amount: 0.1 }).value.amountPaise, 10);
});

test('the same account on both sides is refused', () => {
  assert.match(read({ toAccountId: A }).error, /two different accounts/);
});

test('missing or malformed accounts are refused', () => {
  assert.ok(read({ fromAccountId: '' }).error);
  assert.ok(read({ toAccountId: 'not-an-id' }).error);
});

test('amounts must be positive with at most two decimals and within what an account holds', () => {
  for (const amount of [0, -5, '0', '1.234', 'abc', null, true, '1000000000000']) {
    assert.ok(read({ amount }).error, String(amount));
  }
  assert.equal(read({ amount: '9999999999.99' }).value.amountPaise, 999_999_999_999);
});

test('a future date is refused even with the backdate permission', () => {
  assert.match(read({ date: '2026-11-10' }, true).error, /future/);
});

test('an earlier date needs the backdate permission', () => {
  const refused = read({ date: '2026-11-01' });
  assert.equal(refused.status, 403);
  assert.equal(read({ date: '2026-11-01' }, true).value.date, '2026-11-01');
});

test('invalid dates and over-long descriptions are refused', () => {
  assert.ok(read({ date: '2026-13-40' }).error);
  assert.ok(read({ date: '1999-12-31' }, true).error);
  assert.ok(read({ description: 'x'.repeat(201) }).error);
});

test('a malformed request id is refused; none at all is allowed', () => {
  assert.ok(read({ requestId: 'abc' }).error);
  assert.equal(read({ requestId: undefined }).value.requestId, null);
});

test('money shows paise only when there are some', () => {
  assert.equal(money(150_000), '₹1,500');
  assert.equal(money(150_050), '₹1,500.50');
});
