/**
 * The budget endpoints through the real routes, against a stand-in database.
 *
 * The SQL itself (that only settled expenses are summed, by their share) is
 * covered by the end-to-end run against Postgres; these tests cover what the
 * routes decide: sign-in, permission, validation, ownership and the shape of
 * what is saved and returned. Run with --experimental-test-module-mocks.
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
  namedExports: {
    query: db.query,
    transaction: db.transaction,
    pool: db.pool,
    closePool: db.closePool
  }
});

const { createApp } = await import('../src/app.mjs');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => db.reset());

const USER = '33333333-3333-4333-8333-333333333333';
const BUDGET = '44444444-4444-4444-8444-444444444444';

const thisMonth = new Date().toISOString().slice(0, 7);

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

function account(flags = {}) {
  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow(flags) }
  ]);
}

/** A month with no budget and nothing spent, unless a test says otherwise. */
function emptyMonth() {
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2/, () => []);
  db.on(/from expenses\s+where user_id = \$1 and spent_on >= \$2/, () => []);
}

/** The plumbing saveBudget runs through, recording what it writes. */
function savable(existing = { total: null, categories: [] }) {
  db.on(/insert into monthly_budgets/, () => []);
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2\s+for update/, () => [
    { id: BUDGET, total_budget: existing.total }
  ]);
  db.on(/from category_budgets\s+where monthly_budget_id/, () => existing.categories);
  db.on(/update monthly_budgets set total_budget/, () => []);
  db.on(/delete from category_budgets/, () => []);
  db.on(/insert into category_budgets/, () => []);
  db.on(/delete from budget_alerts/, () => []);
  db.on(/insert into budget_alerts/, () => []);
  db.on(/delete from monthly_budgets where id/, () => []);
}

async function call(method, path, { body, as = 'user', signedIn = true } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(signedIn ? { cookie: cookie(as) } : {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// ------------------------------------------------------------ access

test('budgets need a sign-in', async () => {
  const result = await call('GET', `/api/budgets/${thisMonth}`, { signedIn: false });

  assert.equal(result.status, 401);
});

test('every budget and spending query is scoped to the signed-in user', async () => {
  account();
  emptyMonth();

  const result = await call('GET', `/api/budgets/${thisMonth}`);
  const scoped = db.ran(/monthly_budgets|from expenses/);

  assert.equal(result.status, 200);
  assert.ok(scoped.length >= 2);
  assert.ok(scoped.every(entry => entry.params[0] === USER), 'user id is always the first parameter');
});

test('a restricted sign-in can see budgets but not change them', async () => {
  account({ budget_user_access: false });
  emptyMonth();
  savable();

  const seen = await call('GET', `/api/budgets/${thisMonth}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.canManage, false);

  const changes = [
    ['PUT', `/api/budgets/${thisMonth}`, { total: 30000, categories: [] }],
    ['PUT', `/api/budgets/${thisMonth}/total`, { amount: 30000 }],
    ['PUT', `/api/budgets/${thisMonth}/categories/Travel`, { amount: 3000 }],
    ['DELETE', `/api/budgets/${thisMonth}/categories/Travel`],
    ['DELETE', `/api/budgets/${thisMonth}`]
  ];

  for (const [method, path, body] of changes) {
    assert.equal((await call(method, path, { body })).status, 403, `${method} ${path}`);
  }

  assert.equal(db.ran(/insert into monthly_budgets|update monthly_budgets|delete from monthly_budgets/).length, 0);
});

test('full access may change budgets whatever the switch says', async () => {
  account({ budget_user_access: false });
  emptyMonth();
  savable();

  const result = await call('PUT', `/api/budgets/${thisMonth}/total`, {
    as: 'admin',
    body: { amount: 30000 }
  });

  assert.equal(result.status, 200);
  assert.equal(db.ran(/update monthly_budgets set total_budget/)[0].params[0], '30000.00');
});

// ------------------------------------------------------------ validation

test('bad months are refused before anything is read', async () => {
  account();

  for (const month of ['2026-13', 'november', '1999-12', '9999-01']) {
    assert.equal((await call('GET', `/api/budgets/${month}`)).status, 400, month);
  }

  assert.equal(db.ran(/monthly_budgets/).length, 0);
});

test('amounts must be positive, sane numbers', async () => {
  account();
  savable();

  for (const amount of [0, -5, 'abc', true, 1_000_000_000, '1e5']) {
    const result = await call('PUT', `/api/budgets/${thisMonth}/categories/Travel`, { body: { amount } });
    assert.equal(result.status, 400, JSON.stringify(amount));
  }

  assert.equal(db.ran(/insert into category_budgets/).length, 0);
});

test('a category must be one of the expense categories', async () => {
  account();
  savable();

  const result = await call('PUT', `/api/budgets/${thisMonth}/categories/Rent`, { body: { amount: 500 } });

  assert.equal(result.status, 400);
});

test('the same category twice in one budget is refused', async () => {
  account();
  savable();

  const result = await call('PUT', `/api/budgets/${thisMonth}`, {
    body: {
      total: 30000,
      categories: [
        { category: 'Travel', amount: 3000 },
        { category: 'travel', amount: 4000 }
      ]
    }
  });

  assert.equal(result.status, 400);
  assert.match(result.body.error, /listed twice/);
});

// --------------------------------------------------------------- saving

test('a whole budget is saved in one go and the month is returned', async () => {
  account();
  savable();
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2\s*$/, () => [
    { id: BUDGET, total_budget: 30000 }
  ]);
  db.on(/from expenses\s+where user_id = \$1 and spent_on >= \$2/, () => []);
  db.on(/from budget_alerts\s+where monthly_budget_id/, () => []);

  const result = await call('PUT', `/api/budgets/${thisMonth}`, {
    body: { total: 30000, categories: [{ category: 'food & drink', amount: 5000 }] }
  });

  assert.equal(result.status, 200);

  const inserted = db.ran(/insert into category_budgets/)[0];

  assert.deepEqual(inserted.params[1], ['Food & Drink'], 'stored with the list spelling');
  assert.deepEqual(inserted.params[2], ['5000.00']);
});

test('removing the last part of a budget removes the month', async () => {
  account();
  emptyMonth();
  savable({ total: null, categories: [{ category: 'Travel', amount: 3000 }] });

  const result = await call('DELETE', `/api/budgets/${thisMonth}/categories/Travel`);

  assert.equal(result.status, 200);
  assert.equal(db.ran(/delete from monthly_budgets where id/).length, 1);
});

test('copy offers the latest earlier budget, amounts only', async () => {
  account();
  db.on(/select month from monthly_budgets/, () => [{ month: '2026-09-01' }]);
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2/, () => [
    { id: BUDGET, total_budget: 30000 }
  ]);
  db.on(/from category_budgets\s+where monthly_budget_id/, () => [
    { category: 'Travel', amount: 3000 }
  ]);

  const result = await call('GET', `/api/budgets/${thisMonth}/previous`);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    month: '2026-09',
    total: 30000,
    categories: [{ category: 'Travel', amount: 3000 }]
  });
  assert.equal(db.ran(/from expenses/).length, 0, 'what was spent is not part of a copy');
});

test('history is bounded to 2–12 months', async () => {
  account();

  assert.equal((await call('GET', `/api/budgets/history?end=${thisMonth}&months=24`)).status, 400);
  assert.equal((await call('GET', '/api/budgets/history?end=nonsense')).status, 400);
});

// ---------------------------------------------------------------- alerts

test('a new expense that crosses a threshold reports it, once', async () => {
  account();
  db.on(/from balances/, () => []);
  db.on(/insert into expenses/, params => [{
    id: 'e1', amount: params[1], description: params[2], spent_on: params[3], category: 'Travel',
    source_id: null, source_type: null, source_category: null, expense_access: false,
    update_permission: true, balance_updated: false, status: 'done', remarks: null,
    created_at: null, split_members: null, split_share: null, personal_share: null
  }]);
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2/, () => [
    { id: BUDGET, total_budget: null }
  ]);
  db.on(/from category_budgets\s+where monthly_budget_id/, () => [
    { category: 'Travel', amount: 3000 }
  ]);
  db.on(/from expenses\s+where user_id = \$1 and spent_on >= \$2/, () => [
    { category: 'Travel', status: 'done', spent: 2460 }
  ]);

  // The first insert claims 50% and 80%; a repeat finds them already claimed.
  let claimed = false;
  db.on(/insert into budget_alerts/, () => {
    if (claimed) {
      return [];
    }

    claimed = true;
    return [{ scope: 'Travel', threshold: 50 }, { scope: 'Travel', threshold: 80 }];
  });

  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const body = { amount: 460, description: 'Cab', category: 'Travel', date: today, tzOffset: -330 };

  const first = await call('POST', '/api/expenses', { body });
  const second = await call('POST', '/api/expenses', { body });

  assert.equal(first.status, 201);
  assert.deepEqual(first.body.budgetAlerts, [{
    scope: 'Travel',
    threshold: 80,
    message: 'Travel is at 82% of its ₹3,000 budget — ₹540 left.'
  }]);
  assert.deepEqual(second.body.budgetAlerts, []);
});

test('a pending expense raises no budget alert', async () => {
  account({ update_permission_user: false });
  db.on(/insert into expenses/, params => [{
    id: 'e2', amount: params[1], description: params[2], spent_on: params[3], category: null,
    source_id: null, source_type: null, source_category: null, expense_access: false,
    update_permission: false, balance_updated: false, status: 'pending', remarks: null,
    created_at: null, split_members: null, split_share: null, personal_share: null
  }]);

  const result = await call('POST', '/api/expenses', {
    body: { amount: 50, description: 'Old receipt', date: '2025-01-15', tzOffset: -330 }
  });

  assert.equal(result.status, 201);
  assert.deepEqual(result.body.budgetAlerts, []);
  assert.equal(db.ran(/monthly_budgets/).length, 0, 'not even looked up');
});
