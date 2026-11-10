/**
 * The rules for reading an imported file's rows: dates, amounts, kinds,
 * categories, accounts, permissions, duplicates and the balance play-forward.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRow,
  importOrder,
  indexExisting,
  matchAccount,
  matchCategory,
  parseImportAmount,
  parseImportDate,
  parseKind,
  previewRows,
  readRawRow,
  summarise
} from '../src/import.mjs';

const TODAY = '2026-11-10';

const BANK = { id: 'bank', type: 'Bank Account', category: 'HDFC Bank', balance: 1000 };
const CASH = { id: 'cash', type: 'Hand Cash', category: 'Cash', balance: 50 };

const ALL = {
  canAddMoney: true, canUpdateBalance: true, canBackdate: true, canSeeBalances: true
};

function context(overrides = {}) {
  return {
    today: TODAY,
    defaultKind: 'expense',
    accounts: [BANK, CASH],
    permissions: ALL,
    updateBalances: true,
    ...overrides
  };
}

function raw(fields) {
  return readRawRow({ row: 2, date: '2026-11-05', description: 'Lunch', amount: '250', ...fields });
}

test('dates: ISO, day first, month names and Excel serials', () => {
  assert.deepEqual(parseImportDate('2026-11-05', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('2026-11-05T10:30:00', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('05/11/2026', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('5-11-2026', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('05.11.26', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('5 Nov 2026', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('05-Nov-2026', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('November 5, 2026', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('46331', TODAY), { value: '2026-11-05' });
  assert.deepEqual(parseImportDate('2026/11/05', TODAY), { value: '2026-11-05' });
});

test('dates: impossible, month-first, future, too old and unreadable are refused with a reason', () => {
  assert.match(parseImportDate('31/02/2026', TODAY).error, /not a real date/);
  assert.match(parseImportDate('11/25/2026', TODAY).error, /month first/);
  assert.match(parseImportDate('2026-11-11', TODAY).error, /in the future/);
  assert.match(parseImportDate('1999-12-31', TODAY).error, /too long ago/);
  assert.match(parseImportDate('yesterday', TODAY).error, /Couldn't read the date/);
  assert.match(parseImportDate('', TODAY).error, /missing/);
  assert.match(parseImportDate('12345', TODAY).error, /not a date/);
});

test('amounts are read into exact paise', () => {
  assert.deepEqual(parseImportAmount('250'), { paise: 25000, negative: false });
  assert.deepEqual(parseImportAmount('1,250.50'), { paise: 125050, negative: false });
  assert.deepEqual(parseImportAmount('1,00,000'), { paise: 10000000, negative: false });
  assert.deepEqual(parseImportAmount('₹ 99.9'), { paise: 9990, negative: false });
  assert.deepEqual(parseImportAmount('Rs. 45'), { paise: 4500, negative: false });
  assert.deepEqual(parseImportAmount('INR 45/-'), { paise: 4500, negative: false });
  assert.deepEqual(parseImportAmount('-250'), { paise: 25000, negative: true });
  assert.deepEqual(parseImportAmount('(250.00)'), { paise: 25000, negative: true });
  assert.deepEqual(parseImportAmount('0.1'), { paise: 10, negative: false });
  assert.deepEqual(parseImportAmount('12.300'), { paise: 1230, negative: false });
  // 0.1 + 0.2 in floating point would not survive this; strings do.
  assert.equal(parseImportAmount('19.99').paise, 1999);
});

test('amounts: zero, too many decimals, decimal commas, text and over the cap are refused', () => {
  assert.match(parseImportAmount('0').error, /more than zero/);
  assert.match(parseImportAmount('12.345').error, /two decimal places/);
  assert.match(parseImportAmount('1.250,50').error, /not an amount/);
  assert.match(parseImportAmount('250,50').error, /comma for paise/);
  assert.match(parseImportAmount('abc').error, /not an amount/);
  assert.match(parseImportAmount('100000.01').error, /most one entry/);
  assert.match(parseImportAmount('').error, /missing/);
  assert.equal(parseImportAmount('100000').paise, 10000000);
});

test('kinds understand the words exports and banks use', () => {
  for (const word of ['Expense', 'debit', 'DR', 'Money out', 'Withdrawal']) {
    assert.equal(parseKind(word), 'expense', word);
  }

  for (const word of ['Income', 'Credit', 'cr.', 'Money in', 'Deposit']) {
    assert.equal(parseKind(word), 'income', word);
  }

  assert.equal(parseKind(''), '');
  assert.equal(parseKind('Transfer'), null);
});

test('categories match the app list, aliases and blanks, and refuse the wrong kind', () => {
  assert.deepEqual(matchCategory('food & drink', 'expense'), { value: 'Food & Drink' });
  assert.deepEqual(matchCategory('Food', 'expense'), { value: 'Food & Drink' });
  assert.deepEqual(matchCategory('Uncategorised', 'expense'), { value: null });
  assert.deepEqual(matchCategory('', 'income'), { value: null });
  assert.deepEqual(matchCategory('salary', 'income'), { value: 'Salary' });
  assert.match(matchCategory('Salary', 'expense').error, /income category/);
  assert.match(matchCategory('Groceries', 'income').error, /expense category/);
  assert.match(matchCategory('Fuel', 'expense').error, /not an expense category/);
  assert.match(matchCategory('Repayment', 'income').error, /Repayments/);
});

test('accounts match by name, with or without their type, and refuse unknown or ambiguous names', () => {
  assert.equal(matchAccount('hdfc bank', [BANK, CASH]).account, BANK);
  assert.equal(matchAccount('Bank Account - HDFC Bank', [BANK, CASH]).account, BANK);
  assert.equal(matchAccount('HDFC Bank (Bank Account)', [BANK, CASH]).account, BANK);
  assert.equal(matchAccount('', [BANK]).account, null);
  assert.match(matchAccount('SBI', [BANK]).error, /no account called "SBI"/);

  const twin = { ...BANK, id: 'bank2', type: 'Savings' };
  assert.match(matchAccount('HDFC Bank', [BANK, twin]).error, /More than one/);
});

test('an expense with an account debits it; without one it is only listed', () => {
  const paid = checkRow(raw({ account: 'HDFC Bank', category: 'Food' }), context());
  assert.deepEqual(paid.errors, []);
  assert.equal(paid.kind, 'expense');
  assert.equal(paid.amountPaise, 25000);
  assert.equal(paid.category, 'Food & Drink');
  assert.equal(paid.moves, 'debit');
  assert.equal(paid.settle, 'done');

  const listed = checkRow(raw({}), context());
  assert.equal(listed.moves, null);
  assert.equal(listed.account, null);
});

test('the Type column wins over the file-wide choice, and a negative amount with a Type is fine', () => {
  const row = checkRow(raw({ type: 'Credit', amount: '-500', account: 'Cash' }), context());
  assert.equal(row.kind, 'income');
  assert.equal(row.amountPaise, 50000);
  assert.deepEqual(row.errors, []);
});

test('sign mode: negative is an expense, positive is income', () => {
  assert.equal(checkRow(raw({ amount: '-20' }), context({ defaultKind: 'sign' })).kind, 'expense');
  assert.equal(checkRow(raw({ amount: '20', account: 'Cash' }), context({ defaultKind: 'sign' })).kind, 'income');
});

test('a negative amount in an expense-only file is refused, not flipped', () => {
  assert.match(checkRow(raw({ amount: '-20' }), context()).errors.join(), /negative/);
});

test('income needs an account and the money permissions', () => {
  const income = context({ defaultKind: 'income' });

  assert.match(checkRow(raw({}), income).errors.join(), /needs the account/);
  assert.equal(checkRow(raw({ account: 'HDFC Bank' }), income).moves, 'credit');

  const noMoney = context({ defaultKind: 'income', permissions: { ...ALL, canAddMoney: false } });
  assert.match(checkRow(raw({ account: 'HDFC Bank' }), noMoney).errors.join(), /switched off/);

  const noBalance = context({ defaultKind: 'income', permissions: { ...ALL, canUpdateBalance: false } });
  assert.match(checkRow(raw({ account: 'HDFC Bank' }), noBalance).errors.join(), /cannot change balances/);

  const noBackdate = context({ defaultKind: 'income', permissions: { ...ALL, canBackdate: false } });
  assert.match(checkRow(raw({ account: 'HDFC Bank' }), noBackdate).errors.join(), /another day/);
  assert.deepEqual(checkRow(raw({ account: 'HDFC Bank', date: TODAY }), noBackdate).errors, []);
});

test('without the backdate permission an older expense waits for approval and moves no money yet', () => {
  const row = checkRow(raw({ account: 'HDFC Bank' }), context({ permissions: { ...ALL, canBackdate: false } }));
  assert.equal(row.settle, 'pending');
  assert.equal(row.moves, null);
  assert.match(row.info.join(), /approval/);
});

test('without the balance permission an expense is listed against its account, and says so', () => {
  const row = checkRow(raw({ account: 'HDFC Bank' }), context({ permissions: { ...ALL, canUpdateBalance: false } }));
  assert.equal(row.moves, null);
  assert.equal(row.account, BANK);
  assert.match(row.info.join(), /cannot change balances/);
});

test('with balances left alone nothing moves, and the row says so', () => {
  const row = checkRow(raw({ account: 'HDFC Bank' }), context({ updateBalances: false }));
  assert.equal(row.moves, null);
  assert.match(row.info.join(), /without taking money out/);
});

test('a payment method that names an account is used when Account is blank', () => {
  const row = checkRow(raw({ paymentMethod: 'cash' }), context());
  assert.equal(row.account, CASH);
  assert.match(row.info.join(), /payment method/);

  const kept = checkRow(raw({ paymentMethod: 'UPI' }), context());
  assert.equal(kept.account, null);
  assert.equal(kept.paymentMethod, 'UPI');
});

test('an exported formula guard is taken off the description again', () => {
  assert.equal(checkRow(raw({ description: "'=SUM(A1)" }), context()).description, '=SUM(A1)');
});

test('overlong cells and descriptions are refused', () => {
  assert.match(checkRow(raw({ description: 'x'.repeat(201) }), context()).errors.join(), /200/);
  assert.match(checkRow(raw({ notes: 'x'.repeat(301) }), context()).errors.join(), /notes/);
  assert.match(checkRow(raw({ description: 'x'.repeat(1001) }), context()).errors.join(), /far too long/);
});

test('every reason a row is invalid is listed, not just the first', () => {
  const row = checkRow(raw({ date: 'soon', amount: 'lots', description: '' }), context());
  assert.equal(row.errors.length, 3);
});

test('duplicates: against existing entries and earlier rows in the file', () => {
  const existing = indexExisting(
    [{ id: 'e1', date: '2026-11-05', amount: 250, description: 'lunch ' }],
    []
  );
  const rows = previewRows([
    raw({ row: 2 }),
    readRawRow({ row: 3, date: '2026-11-06', description: 'Tea', amount: '20' }),
    readRawRow({ row: 4, date: '06/11/2026', description: 'TEA', amount: '20.00' })
  ], context(), existing);

  assert.equal(rows[0].status, 'duplicate');
  assert.equal(rows[0].duplicateOf.source, 'existing');
  assert.equal(rows[1].status, 'ready');
  assert.equal(rows[2].status, 'duplicate');
  assert.deepEqual(rows[2].duplicateOf, { source: 'file', row: 3 });
});

test('the same amount as an income does not count as a duplicate of an expense', () => {
  const existing = indexExisting([], [{ id: 'i1', date: '2026-11-05', amount: 250, description: 'Lunch' }]);
  const [row] = previewRows([raw({})], context(), existing);
  assert.equal(row.status, 'ready');
});

test('balances are played forward in date order: income first, then the overdraw is caught', () => {
  const rows = previewRows([
    readRawRow({ row: 2, date: '2026-11-02', description: 'Shoes', amount: '900', account: 'HDFC Bank' }),
    readRawRow({ row: 3, date: '2026-11-03', description: 'Phone', amount: '500', account: 'HDFC Bank' }),
    readRawRow({ row: 4, date: '2026-11-02', description: 'Refund', amount: '100', account: 'HDFC Bank', type: 'Income' })
  ], context(), new Map());

  // 1000 + 100 - 900 = 200, which cannot cover 500.
  assert.equal(rows[0].status, 'ready');
  assert.equal(rows[2].status, 'ready');
  assert.equal(rows[1].status, 'invalid');
  assert.match(rows[1].errors.join(), /Not enough in HDFC Bank: needs ₹500, would have ₹200/);
});

test('the overdraw message leaves the balance out when this sign-in may not see it', () => {
  const [row] = previewRows(
    [raw({ amount: '5000', account: 'HDFC Bank' })],
    context({ permissions: { ...ALL, canSeeBalances: false } }),
    new Map()
  );
  assert.doesNotMatch(row.errors.join(), /₹/);
});

test('excluded rows move no money and are not the first of a duplicate pair', () => {
  const rows = previewRows([
    readRawRow({ row: 2, date: '2026-11-02', description: 'Shoes', amount: '900', account: 'HDFC Bank', skip: true }),
    readRawRow({ row: 3, date: '2026-11-03', description: 'Shoes', amount: '900', account: 'HDFC Bank' })
  ], context(), new Map());

  assert.equal(rows[1].status, 'ready');
});

test('a duplicate the person keeps counts towards the play-forward and the totals', () => {
  const existing = indexExisting([{ id: 'e1', date: '2026-11-05', amount: 900, description: 'Shoes' }], []);
  const rows = previewRows([
    readRawRow({ row: 2, date: '2026-11-05', description: 'Shoes', amount: '900', account: 'HDFC Bank', allowDuplicate: true }),
    readRawRow({ row: 3, date: '2026-11-06', description: 'Bag', amount: '200', account: 'HDFC Bank' })
  ], context(), existing);

  assert.equal(rows[0].status, 'duplicate');
  assert.equal(rows[1].status, 'invalid');

  const summary = summarise(rows);
  assert.equal(summary.toImport, 1);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.invalid, 1);
  assert.deepEqual(summary.accounts, [{ name: 'HDFC Bank', changePaise: -90000 }]);
});

test('the summary counts each status and totals what would be imported', () => {
  const rows = previewRows([
    raw({ row: 2, account: 'HDFC Bank' }),
    readRawRow({ row: 3, date: '2026-11-06', description: 'Salary', amount: '30000', type: 'income', account: 'Cash' }),
    readRawRow({ row: 4, date: 'bad', description: 'x', amount: '1' }),
    readRawRow({ row: 5, date: '2026-11-06', description: 'Tea', amount: '20', skip: true })
  ], context(), new Map());
  const summary = summarise(rows);

  assert.equal(summary.total, 4);
  assert.equal(summary.ready, 3);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.toImport, 2);
  assert.deepEqual(summary.expenses, { count: 1, paise: 25000 });
  assert.deepEqual(summary.incomes, { count: 1, paise: 3000000 });
});

test('import order: oldest first, income before expenses on a day, then file order', () => {
  const rows = [
    { row: 5, date: '2026-11-02', kind: 'expense' },
    { row: 2, date: '2026-11-03', kind: 'expense' },
    { row: 4, date: '2026-11-02', kind: 'income' },
    { row: 3, date: '2026-11-02', kind: 'expense' }
  ];
  assert.deepEqual(rows.sort(importOrder).map(row => row.row), [4, 3, 5, 2]);
});
