/**
 * Importing transactions through the real routes, against a stand-in database
 * that keeps accounts, entries and the import log in memory: the preview, the
 * import itself, balances, permissions, ownership, duplicates, partial
 * failures and retries, and that no existing entry is ever changed.
 *
 * Real locking and constraint behaviour is exercised against Postgres in the
 * end-to-end run described in TRANSACTION_IMPORT_REPORT.md.
 * Run with --experimental-test-module-mocks.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createFakeDb, settingsRow } from './helpers/fake-db.mjs';

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long';

process.env['JWT_SECRET'] = SECRET;
process.env['DATABASE_URL'] = 'postgres://nobody@127.0.0.1:1/never';

const db = createFakeDb();

mock.module('../src/db.mjs', {
  namedExports: { query: db.query, transaction: db.transaction, pool: db.pool, closePool: db.closePool }
});

const { createApp } = await import('../src/app.mjs');
const { callerToday } = await import('../src/http.mjs');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => db.reset());

const USER = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';
const BATCH = '0eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BANK = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASH = '0ccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH = 'a'.repeat(64);
const today = callerToday(0);
const lastMonth = (() => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
})();

/** Statements that would change an entry that was already there. */
const CHANGES_EXISTING = /\b(update|delete from)\s+(expenses|incomes)\b/;

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

async function call(method, path, { body, loginType = 'user', raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookie(loginType) },
    body: raw ?? (body ? JSON.stringify(body) : undefined)
  });

  return { status: res.status, body: await res.json() };
}

/**
 * A small in-memory ledger behind the SQL the import runs.
 *
 * @returns the state, so a test can look at balances and entries afterwards
 */
function ledger({ flags = {}, expenses = [], incomes = [], logged = [], batchOwner = null } = {}) {
  const state = {
    balances: {
      [BANK]: { id: BANK, type: 'Bank Account', category: 'HDFC Bank', balance: 1000, saved: true },
      [CASH]: { id: CASH, type: 'Hand Cash', category: 'Cash', balance: 0, saved: true }
    },
    expenses: [...expenses],
    incomes: [...incomes],
    rows: new Map(logged.map(row => [row.row_number, row])),
    batch: batchOwner ? { id: BATCH, user_id: batchOwner } : null,
    savepoint: null
  };

  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow(flags) }
  ]);
  db.on(/from balances\s+where user_id = \$1 and saved = true/, () => Object.values(state.balances));
  db.on(/from expenses t/, params => state.expenses.filter(e => params[1].includes(e.date)
    && !(params[2] && [...state.rows.values()].some(r => r.expense_id === e.id))));
  db.on(/from incomes t/, params => state.incomes.filter(i => params[1].includes(i.date)
    && !(params[2] && [...state.rows.values()].some(r => r.income_id === i.id))));
  db.on(/from import_batches\s+where user_id = \$1 and file_hash/, () => []);
  db.on(/pg_advisory_xact_lock/, () => []);
  db.on(/insert into import_batches/, params => {
    if (state.batch) return [];
    state.batch = { id: params[0], user_id: params[1] };
    return [{ id: params[0] }];
  });
  db.on(/select user_id from import_batches/, () => state.batch ? [{ user_id: state.batch.user_id }] : []);
  db.on(/from import_rows\s+where batch_id = \$1 and row_number = any/, params =>
    [...state.rows.values()].filter(r => params[1].includes(r.row_number)));

  // Savepoints: keep a copy of the ledger and put it back on rollback.
  db.on(/^savepoint/, () => {
    state.savepoint = structuredClone({ balances: state.balances, expenses: state.expenses, incomes: state.incomes });
    return [];
  });
  db.on(/^release savepoint/, () => []);
  db.on(/^rollback to savepoint/, () => {
    Object.assign(state, structuredClone(state.savepoint));
    return [];
  });

  db.on(/from balances\s+where id = \$1 and user_id = \$2 and saved = true\s+for update/, params =>
    state.balances[params[0]] ? [state.balances[params[0]]] : []);
  db.on(/update balances set balance = balance - \$1 where id = \$2/, params => {
    state.balances[params[1]].balance -= params[0];
    return [];
  });
  db.on(/update balances set balance = balance \+ \$1/, params => {
    state.balances[params[1]].balance += params[0];
    return [{ balance: state.balances[params[1]].balance }];
  });
  db.on(/insert into expenses/, params => {
    const entry = { id: `e${state.expenses.length + 1}`, amount: params[1], description: params[2], date: params[3],
      category: params[4], source_id: params[5], expense_access: params[8], balance_updated: params[10],
      status: params[11], remarks: params[12] };
    state.expenses.push(entry);
    return [{ id: entry.id, spent_on: entry.date, status: entry.status }];
  });
  db.on(/insert into incomes/, params => {
    const entry = { id: `i${state.incomes.length + 1}`, amount: params[1], description: params[2], date: params[3],
      category: params[4], target_id: params[5], balance_updated: params[8] };
    state.incomes.push(entry);
    return [{ id: entry.id }];
  });
  db.on(/insert into import_rows/, params => {
    state.rows.set(params[2], {
      row_number: params[2], kind: params[3], status: params[4], error: params[5],
      expense_id: params[6], income_id: params[7], notes: params[8], payment_method: params[9]
    });
    return [];
  });
  db.on(/update import_batches b/, () => {
    const all = [...state.rows.values()];
    return [{
      imported_rows: all.filter(r => r.status === 'imported').length,
      failed_rows: all.filter(r => r.status === 'failed').length
    }];
  });
  db.on(/from monthly_budgets/, () => []);

  return state;
}

function chunk(rows, extra = {}) {
  return {
    fileName: 'C:\\Users\\me\\Downloads\\november.csv',
    fileHash: HASH,
    fileType: 'csv',
    totalRows: rows.length,
    tzOffset: 0,
    rows,
    ...extra
  };
}

const lunch = { row: 2, date: lastMonth, description: 'Lunch', amount: '250', category: 'Food', account: 'HDFC Bank' };

test('every import route needs a session', async () => {
  for (const path of ['/api/imports/preview', `/api/imports/${BATCH}/rows`]) {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 401, path);
  }
});

test('preview checks rows, finds duplicates and changes nothing', async () => {
  const state = ledger({ expenses: [{ id: 'old', date: lastMonth, amount: 250, description: 'lunch' }] });

  const { status, body } = await call('POST', '/api/imports/preview', {
    body: {
      fileHash: HASH,
      tzOffset: 0,
      rows: [
        lunch,
        { row: 3, date: lastMonth, description: 'Salary', amount: '30,000', type: 'Income', account: 'Cash', category: 'salary' },
        { row: 4, date: '31/02/2026', description: 'Bad', amount: 'abc' }
      ]
    }
  });

  assert.equal(status, 200);
  assert.deepEqual(body.rows.map(r => r.status), ['duplicate', 'ready', 'invalid']);
  assert.equal(body.rows[0].duplicateOf.source, 'existing');
  assert.equal(body.rows[1].amountPaise, 3000000);
  assert.equal(body.rows[1].category, 'Salary');
  assert.equal(body.rows[2].errors.length, 2);
  assert.equal(body.summary.total, 3);
  assert.equal(body.summary.toImport, 1);
  assert.deepEqual(body.options.accounts.map(a => a.name), ['HDFC Bank', 'Cash']);
  assert.ok(body.options.expenseCategories.includes('Food & Drink'));

  assert.equal(db.ran(/insert into|update |delete from/).length, 0);
  assert.equal(state.balances[BANK].balance, 1000);
});

test('preview refuses empty, oversized and badly numbered requests', async () => {
  ledger();

  assert.equal((await call('POST', '/api/imports/preview', { body: { rows: [] } })).status, 400);

  const many = Array.from({ length: 2001 }, (_, i) => ({ ...lunch, row: i + 2 }));
  const tooMany = await call('POST', '/api/imports/preview', { body: { rows: many } });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /at most 2,000/);

  const twice = await call('POST', '/api/imports/preview', { body: { rows: [lunch, lunch] } });
  assert.equal(twice.status, 400);
});

test('a 2,000-row preview fits the larger body limit, which other routes do not get', async () => {
  ledger();

  const rows = Array.from({ length: 2000 }, (_, i) => ({
    ...lunch, row: i + 2, description: `Lunch number ${i} with a fairly long description to pad it out`
  }));
  const { status, body } = await call('POST', '/api/imports/preview', { body: { tzOffset: 0, rows } });

  assert.equal(status, 200);
  assert.equal(body.rows.length, 2000);

  const big = JSON.stringify({ description: 'x'.repeat(150_000) });
  assert.equal((await call('POST', '/api/expenses', { raw: big })).status, 413);
});

test('importing an expense debits the account through the shared insert and logs the row', async () => {
  const state = ledger();

  const { status, body } = await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([{ ...lunch, notes: 'Team lunch', paymentMethod: 'Card' }])
  });

  assert.equal(status, 200);
  assert.deepEqual(body.results, [{ row: 2, status: 'imported', kind: 'expense' }]);
  assert.deepEqual(body.batch, { importedRows: 1, failedRows: 0 });
  assert.equal(state.balances[BANK].balance, 750);
  assert.equal(state.expenses[0].amount, 250);
  assert.equal(state.expenses[0].category, 'Food & Drink');
  assert.equal(state.expenses[0].status, 'done');
  assert.equal(state.expenses[0].remarks, 'Imported; balance updated');
  assert.equal(state.rows.get(2).notes, 'Team lunch');
  assert.equal(state.rows.get(2).payment_method, 'Card');
  assert.equal(state.rows.get(2).expense_id, 'e1');
  // The folder is never stored, only the file's own name.
  assert.equal(db.ran(/insert into import_batches/)[0].params[2], 'november.csv');
  assert.equal(db.ran(CHANGES_EXISTING).length, 0);
});

test('importing income credits its account', async () => {
  const state = ledger();

  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([{ row: 2, date: lastMonth, description: 'Salary', amount: '30000.50', type: 'Income', account: 'Cash' }])
  });

  assert.equal(body.results[0].status, 'imported');
  assert.equal(state.balances[CASH].balance, 30000.5);
  assert.equal(state.incomes[0].balance_updated, true);
});

test('with balances left alone, entries are recorded against their accounts and nothing moves', async () => {
  const state = ledger();

  await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([
      lunch,
      { row: 3, date: lastMonth, description: 'Salary', amount: '300', type: 'Income', account: 'Cash' }
    ], { updateBalances: false })
  });

  assert.equal(state.balances[BANK].balance, 1000);
  assert.equal(state.balances[CASH].balance, 0);
  assert.equal(state.expenses[0].source_id, BANK);
  assert.equal(state.expenses[0].balance_updated, false);
  assert.equal(state.incomes[0].target_id, CASH);
  assert.equal(state.incomes[0].balance_updated, false);
});

test('a row that fails is rolled back on its own; the rest of the chunk still imports', async () => {
  const state = ledger();

  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([
      { row: 2, date: lastMonth, description: 'Phone', amount: '900', account: 'HDFC Bank' },
      { row: 3, date: lastMonth, description: 'Laptop', amount: '500', account: 'HDFC Bank' },
      { row: 4, date: lastMonth, description: 'Tea', amount: '20' }
    ])
  });

  assert.deepEqual(body.results.map(r => r.status), ['imported', 'failed', 'imported']);
  assert.match(body.results[1].error, /Insufficient balance/);
  assert.equal(state.balances[BANK].balance, 100);
  assert.deepEqual(state.expenses.map(e => e.description), ['Phone', 'Tea']);
  assert.equal(state.rows.get(3).status, 'failed');
  assert.deepEqual(body.batch, { importedRows: 2, failedRows: 1 });
});

test('invalid rows sent anyway are logged as failed with every reason, never silently dropped', async () => {
  const state = ledger();

  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([{ row: 2, date: 'someday', description: '', amount: '1' }])
  });

  assert.equal(body.results[0].status, 'failed');
  assert.match(body.results[0].error, /date/);
  assert.match(body.results[0].error, /description/);
  assert.equal(state.rows.get(2).status, 'failed');
  assert.equal(state.expenses.length, 0);
});

test('a duplicate is refused at import time unless the person kept it', async () => {
  const existing = [{ id: 'old', date: lastMonth, amount: 250, description: 'Lunch' }];
  let state = ledger({ expenses: existing });

  let { body } = await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch]) });
  assert.equal(body.results[0].status, 'failed');
  assert.match(body.results[0].error, /Already in Transactions: Lunch/);
  assert.equal(state.balances[BANK].balance, 1000);

  db.reset();
  state = ledger({ expenses: existing });
  ({ body } = await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([{ ...lunch, allowDuplicate: true }]) }));
  assert.equal(body.results[0].status, 'imported');
  assert.equal(state.expenses.length, 2);
});

test('sending the same chunk again imports nothing twice', async () => {
  const state = ledger();
  const request = chunk([lunch, { row: 3, date: lastMonth, description: 'Tea', amount: '20' }]);

  await call('POST', `/api/imports/${BATCH}/rows`, { body: request });
  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, { body: request });

  assert.deepEqual(body.results.map(r => [r.status, r.already]), [['imported', true], ['imported', true]]);
  assert.equal(state.expenses.length, 2);
  assert.equal(state.balances[BANK].balance, 750);
});

test('a failed row can be retried under the same import once it is fixed', async () => {
  const state = ledger();

  await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([{ ...lunch, account: 'SBI' }])
  });
  assert.equal(state.rows.get(2).status, 'failed');

  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch]) });
  assert.equal(body.results[0].status, 'imported');
  assert.equal(state.rows.get(2).status, 'imported');
  assert.deepEqual(body.batch, { importedRows: 1, failedRows: 0 });
});

test("another person's import id is not found, and nothing is imported under it", async () => {
  const state = ledger({ batchOwner: OTHER });

  const { status } = await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch]) });

  assert.equal(status, 404);
  assert.equal(state.expenses.length, 0);
});

test('income is refused for a sign-in that may not add money', async () => {
  const state = ledger({ flags: { add_money_user_access: false } });

  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([{ row: 2, date: lastMonth, description: 'Salary', amount: '300', type: 'Income', account: 'Cash' }])
  });

  assert.equal(body.results[0].status, 'failed');
  assert.match(body.results[0].error, /switched off/);
  assert.equal(state.incomes.length, 0);
});

test('without the backdate permission an older expense is added as pending and debits nothing', async () => {
  const state = ledger({ flags: { update_permission_user: false } });

  const { body } = await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch]) });

  assert.equal(body.results[0].status, 'imported');
  assert.equal(state.expenses[0].status, 'pending');
  assert.equal(state.expenses[0].balance_updated, false);
  assert.equal(state.balances[BANK].balance, 1000);
});

test('the full-access sign-in may backdate even when the normal one may not', async () => {
  const state = ledger({ flags: { update_permission_user: false } });

  await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch]), loginType: 'admin' });

  assert.equal(state.expenses[0].status, 'done');
  assert.equal(state.balances[BANK].balance, 750);
});

test('an import touching this month checks the budget afterwards', async () => {
  ledger();

  await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([{ ...lunch, date: today }]) });
  assert.ok(db.ran(/from monthly_budgets/).length > 0);

  db.reset();
  ledger();
  await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch]) });
  assert.equal(db.ran(/from monthly_budgets/).length, 0);
});

test('the import request is checked: id, file details, size and excluded rows', async () => {
  ledger();

  assert.equal((await call('POST', '/api/imports/not-a-uuid/rows', { body: chunk([lunch]) })).status, 400);
  assert.equal((await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch], { fileHash: 'nope' }) })).status, 400);
  assert.equal((await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch], { fileType: 'pdf' }) })).status, 400);
  assert.equal((await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([lunch], { totalRows: 0 }) })).status, 400);
  assert.equal((await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk([{ ...lunch, skip: true }]) })).status, 400);

  const many = Array.from({ length: 101 }, (_, i) => ({ ...lunch, row: i + 2 }));
  assert.equal((await call('POST', `/api/imports/${BATCH}/rows`, { body: chunk(many) })).status, 400);
  assert.equal(db.ran(/insert into/).length, 0);
});

test('rows are imported oldest first whatever order they were sent in', async () => {
  const state = ledger();

  await call('POST', `/api/imports/${BATCH}/rows`, {
    body: chunk([
      { row: 2, date: lastMonth, description: 'Shoes', amount: '1200', account: 'HDFC Bank' },
      { row: 3, date: '2026-01-01', description: 'Refund', amount: '500', type: 'Income', account: 'HDFC Bank' }
    ])
  });

  // The refund comes first, so the shoes can be paid for.
  assert.equal(state.balances[BANK].balance, 300);
  assert.deepEqual(state.expenses.map(e => e.description), ['Shoes']);
});

test('the lists say where an imported entry came from', async () => {
  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow() }
  ]);
  db.on(/from expenses\s+where user_id/, () => [{
    id: 'e1', amount: 250, description: 'Lunch', spent_on: lastMonth, status: 'done',
    import_info: { fileName: 'november.csv', notes: 'Team lunch', paymentMethod: 'Card' }
  }]);
  db.on(/from incomes\s+where user_id/, () => [{ id: 'i1', amount: 9, description: 'Gift', received_on: lastMonth, import_info: null }]);

  const expenses = await call('GET', '/api/expenses');
  assert.deepEqual(expenses.body[0].imported, { fileName: 'november.csv', notes: 'Team lunch', paymentMethod: 'Card' });
  assert.match(db.ran(/from expenses\s+where user_id/)[0].text, /import_rows/);

  const incomes = await call('GET', '/api/incomes');
  assert.equal(incomes.body[0].imported, null);
});
