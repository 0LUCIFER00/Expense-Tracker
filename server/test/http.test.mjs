import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEmail, parseAmount, parseDate } from '../src/http.mjs';

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
