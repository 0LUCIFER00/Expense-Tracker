/**
 * Recurring schedules through the real routes and the real runner, against a
 * stand-in database: sign-in, permissions, validation, ownership, the cron
 * secret, and what the runner writes for a success, a refusal, a retry and a
 * schedule another runner already holds.
 *
 * Real locking and the unique indexes are exercised against Postgres by the
 * end-to-end run described in RECURRING_FEATURE_REPORT.md.
 * Run with --experimental-test-module-mocks.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createFakeDb, settingsRow } from './helpers/fake-db.mjs';

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long';
const CRON = 'cron-secret-for-the-tests-only';

process.env['JWT_SECRET'] = SECRET;
process.env['DATABASE_URL'] = 'postgres://nobody@127.0.0.1:1/never';
process.env['CRON_SECRET'] = CRON;

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
const { runNextOccurrence, retryRun, runDue } = await import('../src/recurring-store.mjs');
const { todayInIndia } = await import('../src/http.mjs');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => db.reset());

const USER = '55555555-5555-4555-8555-555555555555';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const SCHEDULE = '77777777-7777-4777-8777-777777777777';
const RUN = '88888888-8888-4888-8888-888888888888';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';

const today = todayInIndia();

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

function account(flags = {}) {
  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow(flags) }
  ]);
}

async function call(method, path, { body, loginType = 'user', headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookie(loginType), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

function scheduleRow(extra = {}) {
  return {
    id: SCHEDULE, user_id: USER, kind: 'expense', description: 'Rent', amount: 15000,
    category: 'Bills & Utilities', account_id: ACCOUNT, uses_account: true,
    frequency: 'monthly', interval_count: 1, start_on: today, anchor_on: today,
    next_seq: 0, next_due_on: today, end_on: null, remind_days: 1, status: 'active',
    last_run_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    ...extra
  };
}

const createBody = extra => ({
  kind: 'expense', description: 'Rent', amount: 15000, category: 'Bills & Utilities',
  accountId: ACCOUNT, frequency: 'monthly', startOn: today, remindDays: 1, ...extra
});

/** The plumbing a run goes through, with the account holding `balance`. */
function runnable({ row = scheduleRow(), balance = 50000, insertRun = [{ id: RUN }] } = {}) {
  db.on(/from recurring_schedules\s+where id = \$1\s+for update skip locked/, () => [row]);
  db.on(/insert into recurring_runs/, () => insertRun);
  db.on(/savepoint occurrence/, () => []);
  db.on(/from balances\s+where id = \$1 and user_id = \$2 and saved = true\s+for update/, () => [
    { id: ACCOUNT, type: 'Bank', category: 'HDFC Bank', balance }
  ]);
  db.on(/update balances set balance = balance - \$1/, () => []);
  db.on(/update balances set balance = balance \+ \$1/, () => [{ balance: balance + 1 }]);
  db.on(/insert into expenses/, params => [{ id: 'exp-1', spent_on: params[3], status: params[11] }]);
  db.on(/insert into incomes/, params => [{ id: 'inc-1', received_on: params[3] }]);
  db.on(/update recurring_runs set status = 'failed'/, () => []);
  db.on(/update recurring_schedules\s+set next_seq/, () => []);
}

// ---- access ----------------------------------------------------------------

test('every recurring endpoint except the cron needs a sign-in', async () => {
  const res = await fetch(`${base}/api/recurring`);
  assert.equal(res.status, 401);
});

test('the cron endpoint refuses a missing or wrong secret and runs nothing', async () => {
  const none = await fetch(`${base}/api/recurring/cron`);
  const wrong = await fetch(`${base}/api/recurring/cron`, { headers: { authorization: 'Bearer nope' } });

  assert.equal(none.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(db.calls.length, 0);
});

test('the cron endpoint runs with the right secret and reports counts only', async () => {
  db.on(/from recurring_schedules\s+where status = 'active' and next_due_on <= \$1/, () => []);
  db.on(/from recurring_runs\s+where status = 'failed' and attempts < \$2/, () => []);

  db.on(/delete from (expenses|incomes)\s+where deleted_at is not null/, () => []);

  const res = await fetch(`${base}/api/recurring/cron`, { headers: { authorization: `Bearer ${CRON}` } });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['added', 'failed', 'purged', 'today']);
  assert.equal(body.purged, 0);
  // Everyone's due schedules: no user filter.
  assert.equal(db.ran(/next_due_on <= \$1/)[0].params[1], null);

  // The same run clears Recently deleted of anything deleted over 30 days ago.
  const purges = db.ran(/delete from (expenses|incomes)\s+where deleted_at is not null/);
  assert.equal(purges.length, 2);
  // By the database's own clock, which stamped deleted_at: no time is passed in.
  assert.equal(purges[0].params[0], null);
  assert.match(purges[0].text, /coalesce\(\$1::timestamptz, now\(\)\) - interval '30 days'/);
});

test('without "Manage recurring" a normal sign-in cannot create, change, pause, delete or retry', async () => {
  account({ recurring_user_access: false });

  const attempts = [
    ['POST', '/api/recurring', createBody()],
    ['PUT', `/api/recurring/${SCHEDULE}`, createBody({ nextDueOn: today })],
    ['POST', `/api/recurring/${SCHEDULE}/pause`],
    ['POST', `/api/recurring/${SCHEDULE}/resume`],
    ['DELETE', `/api/recurring/${SCHEDULE}`],
    ['POST', `/api/recurring/runs/${RUN}/retry`],
    ['POST', `/api/recurring/runs/${RUN}/skip`]
  ];

  for (const [method, path, body] of attempts) {
    const res = await call(method, path, { body });
    assert.equal(res.status, 403, `${method} ${path}`);
  }

  assert.equal(db.ran(/insert into|update recurring|delete from/).length, 0);
});

test('the full-access sign-in may manage schedules whatever the switch says', async () => {
  account({ recurring_user_access: false });
  db.on(/from balances where id = \$1 and user_id = \$2 and saved = true/, () => [{ id: ACCOUNT }]);
  db.on(/insert into recurring_schedules/, () => [scheduleRow()]);

  const res = await call('POST', '/api/recurring', { body: createBody(), loginType: 'admin' });
  assert.equal(res.status, 201);
});

test('a sign-in that may not change balances cannot schedule a debit from an account', async () => {
  account({ expense_user_access: false });

  const res = await call('POST', '/api/recurring', { body: createBody() });
  assert.equal(res.status, 403);

  // ...but may schedule one that is only listed.
  db.on(/insert into recurring_schedules/, () => [scheduleRow({ account_id: null, uses_account: false })]);
  const listed = await call('POST', '/api/recurring', { body: createBody({ accountId: null }) });
  assert.equal(listed.status, 201);
});

test('scheduled income needs Add Income and balance permission', async () => {
  account({ add_money_user_access: false });

  const res = await call('POST', '/api/recurring', {
    body: createBody({ kind: 'income', category: 'Salary' })
  });

  assert.equal(res.status, 403);
});

test('a restricted sign-in without the backdate permission cannot start in the past', async () => {
  account({ update_permission_user: false });

  const res = await call('POST', '/api/recurring', { body: createBody({ startOn: '2020-01-01' }) });

  assert.equal(res.status, 403);
  assert.equal(db.ran(/insert into recurring_schedules/).length, 0);
});

test('create stores the schedule under the signed-in user, starting on its first date', async () => {
  account();
  db.on(/from balances where id = \$1 and user_id = \$2 and saved = true/, () => [{ id: ACCOUNT }]);
  db.on(/insert into recurring_schedules/, () => [scheduleRow()]);

  const res = await call('POST', '/api/recurring', { body: createBody() });
  const insert = db.ran(/insert into recurring_schedules/)[0];

  assert.equal(res.status, 201);
  assert.equal(insert.params[0], USER);
  assert.equal(insert.params[9], today);
  assert.equal(insert.params[6], true);
  assert.equal(db.ran(/insert into expenses|insert into incomes/).length, 0, 'nothing is created in advance');
});

test("another user's account cannot be used", async () => {
  account();
  db.on(/from balances where id = \$1 and user_id = \$2 and saved = true/, () => []);

  const res = await call('POST', '/api/recurring', { body: createBody() });

  assert.equal(res.status, 400);
  assert.equal(db.ran(/insert into recurring_schedules/).length, 0);
});

test("another user's schedule is not found, and nothing is changed", async () => {
  account();
  db.on(/from recurring_schedules where id = \$1 and user_id = \$2/, () => []);
  db.on(/update recurring_schedules set status = 'paused'/, () => []);
  db.on(/delete from recurring_schedules/, () => ({ rows: [], rowCount: 0 }));

  const edit = await call('PUT', `/api/recurring/${OTHER_ID}`, { body: createBody({ nextDueOn: today }) });
  const pause = await call('POST', `/api/recurring/${OTHER_ID}/pause`);
  const remove = await call('DELETE', `/api/recurring/${OTHER_ID}`);
  const runs = await call('GET', `/api/recurring/${OTHER_ID}/runs`);

  assert.equal(edit.status, 404);
  assert.equal(pause.status, 404);
  assert.equal(remove.status, 404);
  assert.equal(runs.status, 404);

  for (const call of db.ran(/recurring_schedules/)) {
    assert.ok(call.params.includes(USER), 'every schedule query is scoped to the user');
  }
});

test('a malformed id is a 404 without touching the database', async () => {
  account();
  const res = await call('DELETE', '/api/recurring/not-a-uuid');
  assert.equal(res.status, 404);
  assert.equal(db.ran(/recurring_schedules/).length, 0);
});

test('editing changes only the schedule, never entries already added', async () => {
  account();
  db.on(/from recurring_schedules where id = \$1 and user_id = \$2/, () => [scheduleRow({ next_due_on: '2026-12-05' })]);
  db.on(/from recurring_schedules\s+where id = \$1 and user_id = \$2 for update/, () => [scheduleRow({ next_due_on: '2026-12-05' })]);
  db.on(/from balances where id = \$1 and user_id = \$2 and saved = true/, () => [{ id: ACCOUNT }]);
  db.on(/update recurring_schedules\s+set description/, () => [scheduleRow({ amount: 16000 })]);

  const res = await call('PUT', `/api/recurring/${SCHEDULE}`, {
    body: createBody({ amount: 16000, nextDueOn: '2026-12-05' })
  });

  assert.equal(res.status, 200);
  assert.equal(db.ran(/update expenses|update incomes|delete from expenses|delete from incomes/).length, 0);
  assert.equal(db.ran(/update recurring_runs/).length, 0, 'recorded occurrences keep their own copy');
});

test('deleting a schedule does not delete the entries it added', async () => {
  account();
  db.on(/delete from recurring_schedules/, () => ({ rows: [], rowCount: 1 }));

  const res = await call('DELETE', `/api/recurring/${SCHEDULE}`);

  assert.equal(res.status, 204);
  assert.equal(db.ran(/delete from expenses|delete from incomes|update balances/).length, 0);
});

// ---- the runner -----------------------------------------------------------

test('a due expense is added on its date, debits the account and moves the schedule on', async () => {
  runnable();

  const outcome = await runNextOccurrence(SCHEDULE, today);
  const insert = db.ran(/insert into expenses/)[0];
  const moved = db.ran(/update recurring_schedules\s+set next_seq/)[0];

  assert.equal(outcome.status, 'posted');
  assert.equal(insert.params[0], USER);
  assert.equal(insert.params[3], today, 'dated its due date');
  assert.equal(insert.params[11], 'done');
  assert.equal(insert.params[16], RUN, 'linked to its occurrence');
  assert.equal(db.ran(/update balances set balance = balance - \$1/)[0].params[0], 15000);
  assert.equal(moved.params[1], 1);
  assert.ok(moved.params[2] > today);
});

test('an account that is short: nothing is taken, the occurrence fails, the schedule still moves on', async () => {
  runnable({ balance: 100 });

  const outcome = await runNextOccurrence(SCHEDULE, today);

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error, 'Insufficient balance.');
  assert.equal(db.ran(/update balances/).length, 0);
  assert.equal(db.ran(/insert into expenses/).length, 0);
  assert.equal(db.ran(/rollback to savepoint occurrence/).length, 1);
  assert.equal(db.ran(/update recurring_runs set status = 'failed'/).length, 1);
  assert.equal(db.ran(/update recurring_schedules\s+set next_seq/).length, 1);
});

test('a schedule another runner holds is skipped, not repeated', async () => {
  runnable();
  db.on(/for update skip locked/, () => []);

  const outcome = await runNextOccurrence(SCHEDULE, today);

  assert.equal(outcome, null);
  assert.equal(db.ran(/insert into recurring_runs|insert into expenses|update balances/).length, 0);
});

test('an occurrence already recorded is never added again', async () => {
  runnable({ insertRun: [] });

  const outcome = await runNextOccurrence(SCHEDULE, today);

  assert.equal(outcome.status, 'exists');
  assert.equal(db.ran(/insert into expenses|update balances/).length, 0);
});

test('paused, completed and not-yet-due schedules add nothing', async () => {
  for (const row of [
    scheduleRow({ status: 'paused' }),
    scheduleRow({ status: 'completed', next_due_on: null }),
    scheduleRow({ next_due_on: '2999-01-01' })
  ]) {
    db.reset();
    runnable({ row });
    assert.equal(await runNextOccurrence(SCHEDULE, today), null);
    assert.equal(db.ran(/insert into/).length, 0);
  }
});

test('due income credits its account', async () => {
  runnable({ row: scheduleRow({ kind: 'income', description: 'Salary', amount: 75000, category: 'Salary' }) });

  const outcome = await runNextOccurrence(SCHEDULE, today);
  const insert = db.ran(/insert into incomes/)[0];

  assert.equal(outcome.status, 'posted');
  assert.equal(insert.params[3], today);
  assert.equal(insert.params[11], RUN);
  assert.equal(db.ran(/update balances set balance = balance \+ \$1/)[0].params[0], 75000);
});

test('an account deleted since fails visibly instead of quietly not debiting', async () => {
  runnable({ row: scheduleRow({ account_id: null, uses_account: true }) });

  const outcome = await runNextOccurrence(SCHEDULE, today);

  assert.equal(outcome.status, 'failed');
  assert.equal(db.ran(/insert into expenses/).length, 0);
});

test('a retry that succeeds posts with the recorded details and counts the attempt', async () => {
  runnable();
  db.on(/from recurring_runs\s+where id = \$1/, () => [{
    id: RUN, schedule_id: SCHEDULE, user_id: USER, due_on: '2026-11-03', kind: 'expense',
    description: 'Car insurance', amount: 8000, category: 'Other', account_id: ACCOUNT,
    uses_account: true, status: 'failed', attempts: 1, last_error: 'Insufficient balance.',
    last_attempt_on: '2026-11-03'
  }]);
  db.on(/update recurring_runs\s+set status = \$2/, () => []);

  const outcome = await retryRun(RUN, today, { userId: USER });
  const insert = db.ran(/insert into expenses/)[0];
  const update = db.ran(/update recurring_runs\s+set status = \$2/)[0];

  assert.equal(outcome.status, 'posted');
  assert.equal(insert.params[1], 8000);
  assert.equal(insert.params[3], '2026-11-03', 'the date it was due, not today');
  assert.equal(update.params[1], 'posted');
});

test('a retry of something that is not failed does nothing', async () => {
  runnable();
  db.on(/from recurring_runs\s+where id = \$1/, () => [{ id: RUN, status: 'posted' }]);

  assert.equal(await retryRun(RUN, today, { userId: USER }), null);
  assert.equal(db.ran(/insert into expenses/).length, 0);
});

test('automatic retries are limited to attempts below the maximum, once a day', async () => {
  db.on(/from recurring_schedules\s+where status = 'active'/, () => []);
  db.on(/from recurring_runs\s+where status = 'failed' and attempts < \$2 and last_attempt_on < \$1/, () => []);

  await runDue({ today, userId: USER });

  const retry = db.ran(/attempts < \$2/)[0];
  assert.deepEqual(retry.params, [today, 3, USER]);
});

test('sync adds what is due for the signed-in user only', async () => {
  account();
  db.on(/from recurring_schedules\s+where status = 'active'/, () => []);
  db.on(/from recurring_runs\s+where status = 'failed' and attempts/, () => []);
  db.on(/from recurring_schedules s/, () => []);
  db.on(/from recurring_runs\s+where user_id = \$1/, () => []);

  const res = await call('POST', '/api/recurring/sync');

  assert.equal(res.status, 200);
  assert.equal(db.ran(/next_due_on <= \$1/)[0].params[1], USER);
});
