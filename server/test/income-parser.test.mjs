import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../src/whatsapp/parser.mjs';
import {
  INCOME_CATEGORIES,
  guessIncomeCategory,
  normaliseIncomeCategory
} from '../src/categories.mjs';

const ACCOUNTS = [
  { id: 'a1', type: 'Bank Account', category: 'HDFC Bank' },
  { id: 'a2', type: 'Wallet', category: 'Paytm' }
];

test('a leading + marks money coming in', () => {
  const parsed = parseMessage('+50000 salary hdfc', ACCOUNTS);

  assert.equal(parsed.kind, 'income');
  assert.equal(parsed.amount, 50000);
  assert.equal(parsed.description, 'Salary');
  assert.equal(parsed.account.category, 'HDFC Bank');
});

test('the + may be separated from the amount', () => {
  assert.equal(parseMessage('+ 300 refund paytm', ACCOUNTS).kind, 'income');
});

test('an income verb marks it too', () => {
  for (const text of ['received 300 refund', 'got 1200 from client', 'credited 500 bonus']) {
    assert.equal(parseMessage(text, ACCOUNTS).kind, 'income', text);
  }
});

/*
 * "add 250 coffee" is at least as likely to mean an expense, and guessing
 * wrong moves money the wrong way.
 */
test('"add" alone is still an expense', () => {
  const parsed = parseMessage('add 250 coffee', ACCOUNTS);

  assert.equal(parsed.kind, 'expense');
  assert.equal(parsed.description, 'Coffee');
});

test('an ordinary message is still an expense', () => {
  assert.equal(parseMessage('250 coffee hdfc', ACCOUNTS).kind, 'expense');
  assert.equal(parseMessage('1200 groceries', ACCOUNTS).kind, 'expense');
});

test('the direction word is kept out of the description', () => {
  assert.equal(parseMessage('received 300 refund', ACCOUNTS).description, 'Refund');
  assert.equal(parseMessage('+500 added salary', ACCOUNTS).description, 'Salary');
});

test('money in still matches an account, and still asks when ambiguous', () => {
  const two = [
    { id: 'a1', type: 'Bank Account', category: 'Indian Bank' },
    { id: 'a2', type: 'Bank Account', category: 'HDFC Bank' }
  ];

  const parsed = parseMessage('+5000 salary bank', two);

  assert.equal(parsed.kind, 'income');
  assert.equal(parsed.account, null);
  assert.equal(parsed.ambiguousAccounts.length, 2);
});

test('money in with no amount is not understood', () => {
  assert.equal(parseMessage('+salary', ACCOUNTS).kind, 'unknown');
});

test('INCOME_CATEGORIES has no duplicates and ends with the escape hatch', () => {
  assert.equal(new Set(INCOME_CATEGORIES).size, INCOME_CATEGORIES.length);
  assert.equal(INCOME_CATEGORIES.at(-1), 'Other');
});

test('the income list does not overlap the expense categories', async () => {
  const { CATEGORIES } = await import('../src/categories.mjs');
  const shared = INCOME_CATEGORIES.filter(name => CATEGORIES.includes(name));

  // "Other" is the escape hatch on both lists; nothing else should be on both.
  assert.deepEqual(shared, ['Other']);
});

test('normaliseIncomeCategory is forgiving about case and padding', () => {
  assert.equal(normaliseIncomeCategory('  salary '), 'Salary');
  assert.equal(normaliseIncomeCategory('SOLD SOMETHING'), 'Sold something');
});

test('normaliseIncomeCategory rejects an expense category', () => {
  assert.equal(normaliseIncomeCategory('Groceries'), null);
  assert.equal(normaliseIncomeCategory(''), null);
});

test('guessIncomeCategory reads the source out of a description', () => {
  assert.equal(guessIncomeCategory('October salary'), 'Salary');
  assert.equal(guessIncomeCategory('Amazon refund'), 'Refund');
  assert.equal(guessIncomeCategory('sold the old phone'), 'Sold something');
  assert.equal(guessIncomeCategory('client invoice'), 'Business');
});

test('guessIncomeCategory returns null when nothing gives it away', () => {
  assert.equal(guessIncomeCategory('Money in'), null);
  assert.equal(guessIncomeCategory(''), null);
});

test('every income guess is a category the API would accept', () => {
  for (const sample of ['salary', 'refund', 'gift', 'interest', 'sold', 'client']) {
    const guess = guessIncomeCategory(sample);

    assert.notEqual(guess, null, `"${sample}" should be recognised`);
    assert.equal(normaliseIncomeCategory(guess), guess);
  }
});
