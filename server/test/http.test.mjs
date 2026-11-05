import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callerToday,
  normaliseEmail,
  parseAmount,
  parseDate,
  todayInIndia
} from '../src/http.mjs';

test('normaliseEmail lower-cases and trims', () => {
  assert.equal(normaliseEmail('  Ada@Example.COM '), 'ada@example.com');
});

test('normaliseEmail rejects malformed addresses', () => {
  for (const value of ['', 'nope', 'a@b', 'a b@c.com', null, undefined]) {
    assert.equal(normaliseEmail(value), null, `expected ${value} to be rejected`);
  }
});

test('parseAmount accepts money within the allowed range', () => {
  assert.equal(parseAmount(1), 1);
  assert.equal(parseAmount('250.50'), 250.5);
  assert.equal(parseAmount(100000), 100000);
});

test('parseAmount rounds to two decimals', () => {
  assert.equal(parseAmount(10.005), 10.01);
  assert.equal(parseAmount(0.129), 0.13);
});

test('parseAmount rejects zero, negatives, oversize and non-numbers', () => {
  for (const value of [0, -5, 100001, 'abc', NaN, Infinity, null, undefined]) {
    assert.equal(parseAmount(value), null, `expected ${value} to be rejected`);
  }
});

test('parseAmount refuses values Number() would have quietly converted', () => {
  // true became 1, [5] became 5 and '0x10' became 16 before this was tightened.
  for (const value of [true, false, [5], { amount: 5 }, '0x10', '1e3', ' ', '12abc', '-5']) {
    assert.equal(parseAmount(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('parseAmount refuses an amount that rounds to nothing', () => {
  // 0.001 used to reach the database as 0 and fail its check as a 500.
  assert.equal(parseAmount(0.001), null);
  assert.equal(parseAmount('0.004'), null);
  assert.equal(parseAmount(0.005), 0.01);
});

test('callerToday follows the caller, todayInIndia follows India', () => {
  const realNow = Date.now;

  try {
    // 20:00 UTC on 4 Nov is 01:30 on 5 Nov in India.
    Date.now = () => Date.parse('2026-11-04T20:00:00Z');

    assert.equal(callerToday(-330), '2026-11-05');
    assert.equal(callerToday(0), '2026-11-04');
    assert.equal(callerToday('nonsense'), '2026-11-04');
  } finally {
    Date.now = realNow;
  }

  assert.equal(todayInIndia(new Date('2026-11-04T20:00:00Z')), '2026-11-05');
  assert.equal(todayInIndia(new Date('2026-11-04T18:00:00Z')), '2026-11-04');
});

test('parseDate accepts YYYY-MM-DD', () => {
  assert.equal(parseDate('2026-10-30'), '2026-10-30');
});

test('parseDate truncates a timestamp to its date', () => {
  assert.equal(parseDate('2026-10-30T22:15:00.000Z'), '2026-10-30');
});

test('parseDate rejects other shapes', () => {
  for (const value of ['30-10-2026', '2026/10/30', '2026-13-01', 'today', '', null]) {
    assert.equal(parseDate(value), null, `expected ${value} to be rejected`);
  }
});
