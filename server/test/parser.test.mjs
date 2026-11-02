import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAccount, parseMessage } from '../src/whatsapp/parser.mjs';

const ACCOUNTS = [
  { id: 'b1', type: 'Wallet', category: 'Paytm', balance: 5000 },
  { id: 'b2', type: 'Bank Account', category: 'HDFC Bank', balance: 12000 },
  { id: 'b3', type: 'Hand Cash', category: 'Personal', balance: 800 }
];

test('plain amount and description', () => {
  const result = parseMessage('250 coffee', ACCOUNTS);

  assert.equal(result.kind, 'expense');
  assert.equal(result.amount, 250);
  assert.equal(result.description, 'Coffee');
  assert.equal(result.account, null);
});

test('matches an account by category', () => {
  const result = parseMessage('250 coffee paytm', ACCOUNTS);

  assert.equal(result.amount, 250);
  assert.equal(result.description, 'Coffee');
  assert.equal(result.account.id, 'b1');
});

test('matches a multi-word account name, not just its first word', () => {
  const result = parseMessage('1200 groceries hdfc bank', ACCOUNTS);

  assert.equal(result.account.id, 'b2');
  assert.equal(result.description, 'Groceries');
});

test('"cash" resolves to the Hand Cash account', () => {
  const result = parseMessage('80 chai cash', ACCOUNTS);

  assert.equal(result.account.id, 'b3');
  assert.equal(result.description, 'Chai');
});

test('matches an account by its type', () => {
  const result = parseMessage('500 shopping wallet', ACCOUNTS);

  assert.equal(result.account.id, 'b1');
});

test('strips filler words from the description', () => {
  const result = parseMessage('paid 1200 for groceries using hdfc bank', ACCOUNTS);

  assert.equal(result.amount, 1200);
  assert.equal(result.description, 'Groceries');
  assert.equal(result.account.id, 'b2');
});

test('accepts a rupee symbol and thousands separators', () => {
  assert.equal(parseMessage('₹1,250.50 dinner', ACCOUNTS).amount, 1250.5);
  assert.equal(parseMessage('Rs 2,000 rent', ACCOUNTS).amount, 2000);
  assert.equal(parseMessage('INR 75 bus', ACCOUNTS).amount, 75);
});

test('rounds to two decimals', () => {
  assert.equal(parseMessage('10.567 snack', ACCOUNTS).amount, 10.57);
});

test('does not read a quantity glued to letters as the amount', () => {
  // "2kg" must not become ₹2; the real amount is 90.
  const result = parseMessage('90 2kg rice', ACCOUNTS);

  assert.equal(result.amount, 90);
});

test('falls back to a generic description when none is given', () => {
  assert.equal(parseMessage('300', ACCOUNTS).description, 'Expense');
});

test('punctuation after an account name still matches', () => {
  const result = parseMessage('45 auto, gpay', [
    ...ACCOUNTS,
    { id: 'b4', type: 'Wallet', category: 'GPay', balance: 100 }
  ]);

  assert.equal(result.account.id, 'b4');
});

test('an unknown account name is left in the description', () => {
  const result = parseMessage('250 coffee monzo', ACCOUNTS);

  assert.equal(result.account, null);
  assert.match(result.description.toLowerCase(), /monzo/);
});

test('commands are recognised on their own', () => {
  assert.equal(parseMessage('help').kind, 'help');
  assert.equal(parseMessage('Hi').kind, 'help');
  assert.equal(parseMessage('balance').kind, 'balance');
  assert.equal(parseMessage('BAL').kind, 'balance');
  assert.equal(parseMessage('undo').kind, 'undo');
  assert.equal(parseMessage('today').kind, 'list');
});

test('a command word inside a real expense is not a command', () => {
  const result = parseMessage('250 balance transfer fee', ACCOUNTS);

  assert.equal(result.kind, 'expense');
  assert.equal(result.amount, 250);
});

test('link codes are recognised and upper-cased', () => {
  const result = parseMessage('link 4f2k9');

  assert.equal(result.kind, 'link');
  assert.equal(result.code, '4F2K9');
});

test('messages with no amount are unknown', () => {
  for (const text of ['hello there friend', 'coffee', '', '   ', 'thanks!']) {
    assert.equal(parseMessage(text, ACCOUNTS).kind, 'unknown', `for: ${text}`);
  }
});

test('zero is rejected', () => {
  assert.equal(parseMessage('0 nothing', ACCOUNTS).kind, 'unknown');
});

test('a signed amount is not guessed at', () => {
  // "-50 refund" has no obvious reading as an expense, so say so rather than
  // silently booking 50.
  assert.equal(parseMessage('-50 refund', ACCOUNTS).kind, 'unknown');
});

test('matchAccount prefers the longest matching name', () => {
  const accounts = [
    { id: 'x', type: 'Bank Account', category: 'Bank' },
    { id: 'y', type: 'Bank Account', category: 'Bank of Baroda' }
  ];

  assert.equal(matchAccount('500 fees bank of baroda', accounts).account.id, 'y');
});

test('matchAccount returns null when nothing matches', () => {
  assert.equal(matchAccount('250 coffee', ACCOUNTS), null);
});

test('works with no accounts configured', () => {
  const result = parseMessage('250 coffee paytm', []);

  assert.equal(result.kind, 'expense');
  assert.equal(result.account, null);
});


// ---------------------------------------------------------------------------
// Regression: the accounts as they actually exist in the live database. A user
// types the short form ("hdfc"), not the full category ("HDFC Bank").
// ---------------------------------------------------------------------------

const REAL = [
  { id: 'coin',   type: 'Hand Cash',    category: 'Coin' },
  { id: 'note',   type: 'Hand Cash',    category: 'Note' },
  { id: 'indian', type: 'Bank Account', category: 'Indian Bank' },
  { id: 'hdfc',   type: 'Bank Account', category: 'HDFC Bank' },
  { id: 'amazon', type: 'Wallet',       category: 'Amazon Pay' }
];

test('"150 - sunday food - hdfc" matches HDFC Bank and keeps it out of the text', () => {
  const result = parseMessage('150 - sunday food - hdfc', REAL);

  assert.equal(result.kind, 'expense');
  assert.equal(result.amount, 150);
  assert.equal(result.account.id, 'hdfc');
  assert.equal(result.description, 'Sunday food');
  assert.ok(!/hdfc/i.test(result.description), 'account name must not leak into the description');
});

test('the short form of each account name resolves', () => {
  const cases = [
    ['200 lunch hdfc', 'hdfc'],
    ['200 lunch indian', 'indian'],
    ['200 lunch amazon', 'amazon'],
    ['200 lunch coin', 'coin'],
    ['200 lunch note', 'note']
  ];

  for (const [text, expected] of cases) {
    const result = parseMessage(text, REAL);
    assert.equal(result.account?.id, expected, `for: ${text}`);
    assert.equal(result.description, 'Lunch', `description for: ${text}`);
  }
});

test('the full name still resolves and is fully stripped', () => {
  const result = parseMessage('500 shopping amazon pay', REAL);

  assert.equal(result.account.id, 'amazon');
  assert.equal(result.description, 'Shopping');
});

test('a name shared by two accounts is reported as ambiguous, never guessed', () => {
  const result = parseMessage('300 fees bank', REAL);

  assert.equal(result.account, null);
  assert.equal(result.ambiguousAccounts.length, 2);
  assert.deepEqual(
    result.ambiguousAccounts.map(a => a.id).sort(),
    ['hdfc', 'indian']
  );
});

test('the longer name wins over the shared word', () => {
  // "hdfc bank" must beat the ambiguous "bank".
  const result = parseMessage('300 fees hdfc bank', REAL);

  assert.equal(result.account.id, 'hdfc');
  assert.equal(result.ambiguousAccounts, null);
  assert.equal(result.description, 'Fees');
});

test('"cash" is ambiguous when there are two Hand Cash accounts', () => {
  const result = parseMessage('50 tea cash', REAL);

  assert.equal(result.account, null);
  assert.deepEqual(result.ambiguousAccounts.map(a => a.id).sort(), ['coin', 'note']);
});

test('an unrelated word is left in the description', () => {
  const result = parseMessage('150 sunday food', REAL);

  assert.equal(result.account, null);
  assert.equal(result.ambiguousAccounts, null);
  assert.equal(result.description, 'Sunday food');
});

test('dashes and separators never appear in the description', () => {
  assert.equal(parseMessage('150 - sunday food - hdfc', REAL).description, 'Sunday food');
  assert.equal(parseMessage('150 sunday food, hdfc', REAL).description, 'Sunday food');
});
