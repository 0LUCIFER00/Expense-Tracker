/**
 * The two list endpoints the Transactions page searches and filters: each
 * returns only the signed-in account's entries, never deleted ones, and hides
 * account names this sign-in may not see. The page filters on top of exactly
 * this, so this is where isolation is enforced.
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

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => db.reset());

const ASHA = '88888888-8888-4888-8888-888888888888';
const RAVI = '99999999-9999-4999-8999-999999999999';

/** Two accounts' rows behind the SQL, each tagged with its owner. */
const ROWS = {
  expenses: [
    { id: 'a1', user_id: ASHA, amount: 250, description: 'Asha lunch', spent_on: '2026-11-05', status: 'done', source_category: 'HDFC Bank', deleted_at: null },
    { id: 'a2', user_id: ASHA, amount: 99, description: 'Asha binned', spent_on: '2026-11-05', status: 'done', source_category: 'HDFC Bank', deleted_at: '2026-11-08' },
    { id: 'r1', user_id: RAVI, amount: 900, description: 'Ravi shoes', spent_on: '2026-11-05', status: 'done', source_category: 'SBI', deleted_at: null }
  ],
  incomes: [
    { id: 'ai', user_id: ASHA, amount: 5000, description: 'Asha salary', received_on: '2026-11-01', target_category: 'HDFC Bank', deleted_at: null },
    { id: 'ri', user_id: RAVI, amount: 7000, description: 'Ravi salary', received_on: '2026-11-01', target_category: 'SBI', deleted_at: null }
  ]
};

function setUp(flags = {}) {
  db.on(/from users u\s+left join user_settings/, ([user]) => [
    { session_version: 0, has_settings: user, ...settingsRow(flags) }
  ]);
  // Answers as Postgres would to the query as written: the WHERE is honoured.
  for (const table of ['expenses', 'incomes']) {
    db.on(new RegExp(`from ${table}\\s+where user_id = \\$1`), ([user], text) =>
      ROWS[table].filter(r => r.user_id === user && (!/deleted_at is null/.test(text) || !r.deleted_at)));
  }
}

async function get(path, user) {
  const headers = user
    ? { cookie: `et_session=${jwt.sign({ sub: user, loginType: 'user', ver: 0 }, SECRET, { algorithm: 'HS256' })}` }
    : {};
  const res = await fetch(base + path, { headers });

  return { status: res.status, body: await res.json() };
}

test('each account sees only its own expenses and income', async () => {
  setUp();

  const asha = await get('/api/expenses', ASHA);
  const ravi = await get('/api/expenses', RAVI);

  assert.deepEqual(asha.body.map(e => e.description), ['Asha lunch']);
  assert.deepEqual(ravi.body.map(e => e.description), ['Ravi shoes']);
  assert.deepEqual((await get('/api/incomes', ASHA)).body.map(i => i.description), ['Asha salary']);

  // The user id comes from the session alone; nothing in the request can change it.
  for (const call of db.ran(/from (expenses|incomes)\s+where user_id = \$1/)) {
    assert.ok([ASHA, RAVI].includes(call.params[0]));
    assert.equal(call.params.length, 1);
  }
});

test('a query string cannot reach another account', async () => {
  setUp();

  const { body } = await get(`/api/expenses?user=${RAVI}&userId=${RAVI}`, ASHA);

  assert.deepEqual(body.map(e => e.description), ['Asha lunch']);
});

test('entries in Recently deleted are never in the normal lists', async () => {
  setUp();

  const { body } = await get('/api/expenses', ASHA);

  assert.ok(!body.some(e => e.description === 'Asha binned'));
});

test('without a session the lists are refused', async () => {
  setUp();

  assert.equal((await get('/api/expenses')).status, 401);
  assert.equal((await get('/api/incomes')).status, 401);
});

test('account names are withheld where this sign-in may not see them, so no filter can reveal them', async () => {
  setUp({ view_permission_user: false });

  const [expense] = (await get('/api/expenses', ASHA)).body;
  const [income] = (await get('/api/incomes', ASHA)).body;

  assert.equal(expense.sourceCategory, null);
  assert.equal(income.targetCategory, null);
});
