/**
 * Savings goals through the real routes against a stand-in database: sign-in,
 * the Manage savings goals permission, validation, ownership, status changes,
 * contributions and withdrawals under a row lock, and that nothing outside the
 * goal tables is ever read or written.
 *
 * Real concurrency is exercised against Postgres by the end-to-end run
 * described in SAVINGS_GOALS_REPORT.md. Run with --experimental-test-module-mocks.
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
const { todayInIndia } = await import('../src/http.mjs');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => db.reset());

const USER = '12121212-1212-4212-8212-121212121212';
const GOAL = '34343434-3434-4434-8434-343434343434';
const OTHER = '56565656-5656-4656-8656-565656565656';
const today = todayInIndia();
const nextYear = `${Number(today.slice(0, 4)) + 1}-03-31`;

/** Tables a goal must never touch. */
const ELSEWHERE = /\b(balances|expenses|incomes|monthly_budgets|category_budgets|budget_alerts|recurring_schedules|recurring_runs)\b/;

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

function goalRow(extra = {}) {
  return {
    id: GOAL, user_id: USER, name: 'Emergency fund', description: null, icon: 'emergency',
    // bigint arrives from Postgres as text.
    target_paise: '15000000', saved_paise: '9200000', target_date: nextYear,
    status: 'active', created_on: today, completed_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...extra
  };
}

/** The lock + update + insert an entry runs through, recording the new total. */
function entryPlumbing(row = goalRow()) {
  db.on(/from savings_goals where id = \$1 and user_id = \$2 for update/, () => [row]);
  db.on(/update savings_goals set saved_paise = \$3/, params => [{ ...row, saved_paise: String(params[2]) }]);
  db.on(/insert into savings_goal_activity/, params => [{
    id: 'a1', goal_id: GOAL, kind: params[2], amount_paise: String(params[3]), on_date: params[4],
    note: params[5], saved_after_paise: String(params[6]), created_at: '2026-11-06T00:00:00Z'
  }]);
}

function noOtherTables() {
  assert.equal(db.calls.filter(c => !/user_settings|from users u/.test(c.text) && ELSEWHERE.test(c.text)).length, 0,
    'no balance, transaction, budget or recurring table is touched');
}

test('goals need a sign-in', async () => {
  assert.equal((await fetch(`${base}/api/goals`)).status, 401);
});

test('listing returns figures worked out on the server, and totals', async () => {
  account();
  db.on(/from savings_goals where user_id = \$1/, () => [
    goalRow(),
    goalRow({ id: OTHER, name: 'Bike', target_paise: '6000000', saved_paise: '6000000', status: 'completed' })
  ]);

  const res = await call('GET', '/api/goals');

  assert.equal(res.status, 200);
  assert.equal(res.body.goals[0].saved, 92000);
  assert.equal(res.body.goals[0].remaining, 58000);
  assert.equal(res.body.goals[0].percent, 61);
  assert.ok(res.body.goals[0].monthly > 0);
  assert.deepEqual(res.body.summary, {
    totalTarget: 210000, totalSaved: 152000, percent: 72, active: 1, paused: 0, completed: 1
  });
  noOtherTables();
});

test('without Manage savings goals a normal sign-in can see but not change anything', async () => {
  account({ goals_user_access: false });
  db.on(/from savings_goals where user_id = \$1/, () => [goalRow()]);

  const seen = await call('GET', '/api/goals');
  assert.equal(seen.status, 200);
  assert.equal(seen.body.canManage, false);

  const writes = [
    ['POST', '/api/goals', { name: 'x', target: 1, targetDate: nextYear }],
    ['PUT', `/api/goals/${GOAL}`, { name: 'x', target: 1, targetDate: nextYear }],
    ['POST', `/api/goals/${GOAL}/pause`], ['POST', `/api/goals/${GOAL}/resume`],
    ['POST', `/api/goals/${GOAL}/complete`], ['POST', `/api/goals/${GOAL}/reopen`],
    ['DELETE', `/api/goals/${GOAL}`],
    ['POST', `/api/goals/${GOAL}/contributions`, { amount: 100 }],
    ['POST', `/api/goals/${GOAL}/withdrawals`, { amount: 100 }]
  ];

  for (const [method, path, body] of writes) {
    assert.equal((await call(method, path, { body })).status, 403, `${method} ${path}`);
  }

  assert.equal(db.ran(/insert into|update savings|delete from/).length, 0);
});

test('the full-access sign-in may manage goals whatever the switch says', async () => {
  account({ goals_user_access: false });
  db.on(/insert into savings_goals/, () => [goalRow({ saved_paise: '0' })]);

  const res = await call('POST', '/api/goals', {
    body: { name: 'Laptop', target: 85000, targetDate: nextYear }, loginType: 'admin'
  });

  assert.equal(res.status, 201);
});

test('create stores whole paise under the signed-in user; "already saved" is the first history entry', async () => {
  account();
  db.on(/insert into savings_goals/, params => [goalRow({ target_paise: String(params[4]), saved_paise: String(params[5]) })]);
  db.on(/insert into savings_goal_activity/, () => []);

  const res = await call('POST', '/api/goals', {
    body: { name: 'Goa trip', target: '40000', targetDate: nextYear, initialSaved: '20000.50', icon: 'travel' }
  });

  const goal = db.ran(/insert into savings_goals/)[0];
  const first = db.ran(/insert into savings_goal_activity/)[0];

  assert.equal(res.status, 201);
  assert.equal(goal.params[0], USER);
  assert.equal(goal.params[4], 4_000_000);
  assert.equal(goal.params[5], 2_000_050);
  assert.equal(goal.params[7], today, 'created on today, India time');
  assert.equal(first.params[2], 2_000_050);
  noOtherTables();
});

test('bad input is refused with nothing written', async () => {
  account();

  for (const body of [
    { name: '', target: 1, targetDate: nextYear },
    { name: 'x', target: 0, targetDate: nextYear },
    { name: 'x', target: '1.234', targetDate: nextYear },
    { name: 'x', target: 1, targetDate: '2000-01-01' },
    { name: 'x', target: 1, targetDate: nextYear, icon: 'rocket' }
  ]) {
    assert.equal((await call('POST', '/api/goals', { body })).status, 400, JSON.stringify(body));
  }

  assert.equal(db.ran(/insert into/).length, 0);
});

test("another user's goal is not found, and nothing is changed", async () => {
  account();
  db.on(/from savings_goals where id = \$1 and user_id = \$2/, () => []);
  db.on(/delete from savings_goals/, () => ({ rows: [], rowCount: 0 }));

  for (const [method, path, body] of [
    ['GET', `/api/goals/${OTHER}/activity`],
    ['PUT', `/api/goals/${OTHER}`, { name: 'x', target: 1, targetDate: nextYear }],
    ['POST', `/api/goals/${OTHER}/pause`],
    ['DELETE', `/api/goals/${OTHER}`],
    ['POST', `/api/goals/${OTHER}/contributions`, { amount: 100 }],
    ['POST', `/api/goals/${OTHER}/withdrawals`, { amount: 100 }]
  ]) {
    assert.equal((await call(method, path, { body })).status, 404, `${method} ${path}`);
  }

  for (const c of db.ran(/savings_goal/)) {
    assert.ok(c.params.includes(USER), 'every goal query is scoped to the user');
  }

  assert.equal(db.ran(/update savings_goals|insert into savings_goal_activity/).length, 0);
});

test('a malformed id is a 404 without touching the database', async () => {
  account();
  assert.equal((await call('DELETE', '/api/goals/not-an-id')).status, 404);
  assert.equal(db.ran(/savings_goals/).length, 0);
});

test('a contribution locks the goal, adds to the total and records the total it left', async () => {
  account();
  entryPlumbing();

  const res = await call('POST', `/api/goals/${GOAL}/contributions`, { body: { amount: '11600', note: 'Salary' } });

  assert.equal(res.status, 201);
  assert.equal(db.ran(/for update/).length, 1);
  assert.equal(db.ran(/update savings_goals set saved_paise/)[0].params[2], 10_360_000);
  assert.equal(db.ran(/insert into savings_goal_activity/)[0].params[6], 10_360_000);
  assert.equal(res.body.goal.saved, 103600);
  assert.equal(res.body.entry.savedAfter, 103600);
  noOtherTables();
});

test('a withdrawal takes from the total', async () => {
  account();
  entryPlumbing();

  const res = await call('POST', `/api/goals/${GOAL}/withdrawals`, { body: { amount: 8000 } });

  assert.equal(res.status, 201);
  assert.equal(res.body.goal.saved, 84000);
  assert.equal(res.body.entry.kind, 'withdrawal');
  noOtherTables();
});

test('withdrawing more than is saved is refused and nothing is written', async () => {
  account();
  entryPlumbing();

  const res = await call('POST', `/api/goals/${GOAL}/withdrawals`, { body: { amount: '92000.01' } });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /cannot withdraw more/);
  assert.equal(db.ran(/update savings_goals set saved_paise|insert into savings_goal_activity/).length, 0);
});

test('withdrawing everything leaves exactly zero', async () => {
  account();
  entryPlumbing();

  const res = await call('POST', `/api/goals/${GOAL}/withdrawals`, { body: { amount: 92000 } });

  assert.equal(res.status, 201);
  assert.equal(res.body.goal.saved, 0);
});

test('a completed goal takes no contributions or withdrawals until reopened', async () => {
  account();
  entryPlumbing(goalRow({ status: 'completed' }));

  for (const path of ['contributions', 'withdrawals']) {
    assert.equal((await call('POST', `/api/goals/${GOAL}/${path}`, { body: { amount: 1 } })).status, 409);
  }

  assert.equal(db.ran(/update savings_goals set saved_paise/).length, 0);
});

test('a future-dated entry is refused', async () => {
  account();
  const res = await call('POST', `/api/goals/${GOAL}/contributions`, { body: { amount: 1, date: '2999-01-01' } });
  assert.equal(res.status, 400);
});

test('status changes follow the rules; an invalid one is refused', async () => {
  const cases = [
    ['active', 'pause', 200, 'paused'], ['paused', 'resume', 200, 'active'],
    ['active', 'complete', 200, 'completed'], ['paused', 'complete', 200, 'completed'],
    ['completed', 'reopen', 200, 'active'],
    ['paused', 'pause', 409], ['active', 'resume', 409], ['completed', 'complete', 409],
    ['completed', 'pause', 409], ['active', 'reopen', 409]
  ];

  for (const [from, action, status, to] of cases) {
    db.reset();
    account();
    db.on(/from savings_goals where id = \$1 and user_id = \$2 for update/, () => [goalRow({ status: from })]);
    db.on(/update savings_goals\s+set status = \$3/, params => [goalRow({ status: params[2] })]);

    const res = await call('POST', `/api/goals/${GOAL}/${action}`);
    assert.equal(res.status, status, `${from} → ${action}`);

    if (to) {
      assert.equal(res.body.status, to);
    } else {
      assert.equal(db.ran(/update savings_goals/).length, 0);
    }
  }
});

test('editing changes only the goal, never its history or anything else', async () => {
  account();
  db.on(/from savings_goals where id = \$1 and user_id = \$2/, () => [goalRow()]);
  db.on(/update savings_goals\s+set name = \$3/, params => [goalRow({ name: params[2], target_paise: String(params[5]) })]);

  const res = await call('PUT', `/api/goals/${GOAL}`, {
    body: { name: 'Rainy day fund', target: 200000, targetDate: nextYear }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.target, 200000);
  assert.equal(res.body.saved, 92000, 'the saved total is unchanged');
  assert.equal(db.ran(/savings_goal_activity|saved_paise =/).length, 0);
  noOtherTables();
});

test('an edit may keep a target date that has passed', async () => {
  account();
  db.on(/from savings_goals where id = \$1 and user_id = \$2/, () => [goalRow({ target_date: '2026-01-01' })]);
  db.on(/update savings_goals\s+set name = \$3/, () => [goalRow({ target_date: '2026-01-01' })]);

  const res = await call('PUT', `/api/goals/${GOAL}`, { body: { name: 'Old', target: 1, targetDate: '2026-01-01' } });
  assert.equal(res.status, 200);
});

test('deleting removes only the goal (and its history, by cascade)', async () => {
  account();
  db.on(/delete from savings_goals/, () => ({ rows: [], rowCount: 1 }));

  const res = await call('DELETE', `/api/goals/${GOAL}`);

  assert.equal(res.status, 204);
  assert.equal(db.ran(/delete from/).length, 1);
  noOtherTables();
});
