/**
 * Transfers and account deletion through the real routes, against a stand-in
 * database: permissions, validation, ownership, locking, the debit and credit,
 * duplicate requests, and that no expense, income, budget or recurring table
 * is ever written.
 *
 * Real concurrency is exercised against Postgres by the end-to-end run in
 * ACCOUNT_TRANSFERS_REPORT.md. Run with --experimental-test-module-mocks.
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

const USER = '44444444-4444-4444-8444-444444444444';
const BANK = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALLET = '0bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CASH = '0ccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQ = '0ddddddd-dddd-4ddd-8ddd-dddddddddddd';
const today = callerToday(0);

/** Tables a transfer must never write. */
const ELSEWHERE = /\b(insert into|update|delete from)\s+(expenses|incomes|monthly_budgets|category_budgets|budget_alerts|recurring_schedules|recurring_runs|savings_goals)\b/;

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

function account(flags = {}) {
  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow(flags) }
  ]);
}

async function call(method, path, { body, loginType = 'user' } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookie(loginType) },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const ACCOUNTS = {
  [BANK]: { id: BANK, type: 'Bank Account', category: 'HDFC Bank', balance: 5000, saved: true },
  [WALLET]: { id: WALLET, type: 'Wallet', category: 'Paytm', balance: 125.5, saved: true },
  [CASH]: { id: CASH, type: 'Hand Cash', category: 'Personal', balance: 0, saved: true }
};

/** The lock, the two updates and the insert, recording what they were given. */
function transferPlumbing({ existing = null } = {}) {
  db.on(/from balances\s+where user_id = \$1 and id = any/, params =>
    params[1].map(id => ACCOUNTS[id]).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id)));
  db.on(/from account_transfers where user_id = \$1 and request_id = \$2/, () => existing ? [existing] : []);
  db.on(/update balances set balance = balance - /, params => [{ balance: ACCOUNTS[params[1]].balance - params[0] / 100 }]);
  db.on(/update balances set balance = balance \+ /, params => [{ balance: ACCOUNTS[params[1]].balance + params[0] / 100 }]);
  db.on(/insert into account_transfers/, params => [{
    id: 't1', request_id: params[1] ?? 'generated', from_account_id: params[2], to_account_id: params[3],
    from_type: params[4], from_name: params[5], to_type: params[6], to_name: params[7],
    amount_paise: String(params[8]), transfer_date: params[9], description: params[10], created_at: 'now'
  }]);
}

const send = extra => ({ fromAccountId: BANK, toAccountId: WALLET, amount: 1500, requestId: REQ, tzOffset: 0, ...extra });

test('transfers need a sign-in', async () => {
  assert.equal((await fetch(`${base}/api/transfers`)).status, 401);
});

test('a transfer locks both accounts in id order, debits one, credits the other and records it', async () => {
  account();
  transferPlumbing();

  const res = await call('POST', '/api/transfers', { body: send({ description: 'Top up' }) });

  assert.equal(res.status, 201);
  assert.match(db.ran(/from balances/)[0].text, /order by id\s+for update/);
  assert.equal(db.ran(/balance - /)[0].params[0], 150_000);
  assert.equal(db.ran(/balance - /)[0].params[1], BANK);
  assert.equal(db.ran(/balance \+ /)[0].params[0], 150_000);
  assert.equal(db.ran(/balance \+ /)[0].params[1], WALLET);
  assert.deepEqual(
    [res.body.fromBalance, res.body.toBalance, res.body.transfer.amount, res.body.transfer.fromName, res.body.transfer.toName],
    [3500, 1625.5, 1500, 'HDFC Bank', 'Paytm']
  );
  assert.equal(db.calls.filter(c => ELSEWHERE.test(c.text)).length, 0, 'no expense, income, budget or recurring write');
});

test('every pair of account types can transfer', async () => {
  for (const [from, to] of [[BANK, WALLET], [BANK, CASH], [WALLET, BANK], [WALLET, CASH]]) {
    db.reset();
    account();
    transferPlumbing();
    const res = await call('POST', '/api/transfers', { body: send({ fromAccountId: from, toAccountId: to, amount: 100 }) });
    assert.equal(res.status, 201, `${ACCOUNTS[from].type} → ${ACCOUNTS[to].type}`);
  }
});

test('not enough in the source: refused, nothing moves', async () => {
  account();
  transferPlumbing();

  const res = await call('POST', '/api/transfers', { body: send({ fromAccountId: WALLET, toAccountId: BANK, amount: '125.51' }) });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough in Paytm: it holds ₹125.50/);
  assert.equal(db.ran(/update balances|insert into account_transfers/).length, 0);
});

test('exactly the whole balance can be moved, leaving zero', async () => {
  account();
  transferPlumbing();

  const res = await call('POST', '/api/transfers', { body: send({ fromAccountId: WALLET, toAccountId: CASH, amount: '125.50' }) });

  assert.equal(res.status, 201);
  assert.equal(res.body.fromBalance, 0);
});

test('the same request twice is one transfer: the second moves nothing', async () => {
  account();
  transferPlumbing({
    existing: {
      id: 't1', request_id: REQ, from_account_id: BANK, to_account_id: WALLET, from_type: 'Bank Account',
      from_name: 'HDFC Bank', to_type: 'Wallet', to_name: 'Paytm', amount_paise: '150000',
      transfer_date: today, description: null, created_at: 'then'
    }
  });

  const res = await call('POST', '/api/transfers', { body: send() });

  assert.equal(res.status, 200);
  assert.equal(res.body.duplicate, true);
  assert.equal(db.ran(/update balances|insert into account_transfers/).length, 0);
});

test('same account, bad amounts and future dates are refused before the database', async () => {
  account();

  for (const body of [
    send({ toAccountId: BANK }), send({ amount: 0 }), send({ amount: -5 }), send({ amount: '1.005' }),
    send({ date: '2999-01-01' }), send({ date: 'soon' })
  ]) {
    assert.equal((await call('POST', '/api/transfers', { body })).status, 400, JSON.stringify(body));
  }

  assert.equal(db.ran(/balances|account_transfers/).length, 0);
});

test('an earlier date needs "Change transaction dates"', async () => {
  account({ update_permission_user: false });
  const res = await call('POST', '/api/transfers', { body: send({ date: '2026-01-01' }) });
  assert.equal(res.status, 403);
  assert.equal(db.ran(/update balances/).length, 0);
});

test('a sign-in that may not change balances cannot transfer', async () => {
  for (const flags of [{ expense_user_access: false }, { balance_user_access: false }]) {
    db.reset();
    account(flags);
    assert.equal((await call('POST', '/api/transfers', { body: send() })).status, 403, JSON.stringify(flags));
    assert.equal(db.ran(/balances/).length, 0);
  }
});

test('the full-access sign-in may transfer whatever the switches say', async () => {
  account({ expense_user_access: false, balance_user_access: false });
  transferPlumbing();
  assert.equal((await call('POST', '/api/transfers', { body: send(), loginType: 'admin' })).status, 201);
});

test("another user's account (or an unsaved one) cannot be used", async () => {
  account();
  db.on(/from balances\s+where user_id = \$1 and id = any/, () => [ACCOUNTS[BANK]]);

  const res = await call('POST', '/api/transfers', { body: send() });

  assert.equal(res.status, 400);
  assert.equal(db.ran(/from balances/)[0].params[0], USER, 'looked up under the signed-in user');
  assert.equal(db.ran(/update balances/).length, 0);
});

test('the history is the signed-in user\'s, with optional account and date filters', async () => {
  account();
  db.on(/from account_transfers\s+where user_id = \$1/, () => []);

  assert.equal((await call('GET', `/api/transfers?account=${BANK}&from=2026-11-01&to=2026-11-30`)).status, 200);
  assert.deepEqual(db.ran(/from account_transfers/)[0].params.slice(0, 4), [USER, BANK, '2026-11-01', '2026-11-30']);
  assert.equal((await call('GET', '/api/transfers?account=nope')).status, 400);
});

test('the history needs balances to be visible', async () => {
  account({ balance_user_access: false });
  assert.equal((await call('GET', '/api/transfers')).status, 403);
});

// ---- deleting an account -------------------------------------------------

function usage(extra = {}) {
  db.on(/from balances b\s+where b.id = \$1 and b.user_id = \$2/, () => [{
    category: 'Paytm', balance: 0, expenses: 0, incomes: 0, transfers: 0, schedules: 0, ...extra
  }]);
}

test('an empty account with no history is deleted', async () => {
  account();
  usage();
  db.on(/delete from balances/, () => ({ rows: [], rowCount: 1 }));

  assert.equal((await call('DELETE', `/api/balances/${WALLET}`)).status, 204);
  assert.match(db.ran(/delete from balances/)[0].text, /balance = 0/);
});

test('deletion is refused, with reasons, while an account holds money or has history', async () => {
  for (const [extra, pattern] of [
    [{ balance: 125.5 }, /still holds ₹125.50/],
    [{ expenses: 3 }, /3 expenses/],
    [{ incomes: 1 }, /1 income entry/],
    [{ transfers: 2 }, /2 transfers/],
    [{ schedules: 1 }, /1 recurring schedule uses it/]
  ]) {
    db.reset();
    account();
    usage(extra);

    const res = await call('DELETE', `/api/balances/${WALLET}`);

    assert.equal(res.status, 409, JSON.stringify(extra));
    assert.match(res.body.error, pattern);
    assert.equal(db.ran(/delete from balances/).length, 0);
  }
});

test('the page can ask first whether an account can be deleted, and why not', async () => {
  account();
  usage({ balance: 10, transfers: 1 });

  const res = await call('GET', `/api/balances/${WALLET}/usage`);

  assert.equal(res.status, 200);
  assert.equal(res.body.deletable, false);
  assert.equal(res.body.reasons.length, 2);
});

test("another user's account is not found for usage or delete", async () => {
  account();
  db.on(/from balances b\s+where b.id = \$1 and b.user_id = \$2/, () => []);

  assert.equal((await call('GET', `/api/balances/${WALLET}/usage`)).status, 404);
  assert.equal((await call('DELETE', `/api/balances/${WALLET}`)).status, 404);
  assert.equal((await call('DELETE', '/api/balances/not-an-id')).status, 404);
  assert.equal(db.ran(/delete from balances/).length, 0);
});
