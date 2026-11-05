/**
 * The audit's security and permission fixes, exercised through the real routes.
 *
 * The database and bcrypt are replaced (see helpers/fake-db.mjs): the routes,
 * middleware, session handling and permission rules are the real code. Run
 * with --experimental-test-module-mocks, which the test:api script passes.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createFakeDb, settingsRow } from './helpers/fake-db.mjs';

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long';

// Set before anything reads them. DATABASE_URL is never connected to.
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

/*
 * bcrypt at cost 12 takes a quarter of a second per call, and what matters
 * here is how many comparisons are made, not the hashing. A hash is
 * "hashed:<plain>", and every compare is counted.
 */
let compares = 0;

mock.module('bcryptjs', {
  defaultExport: {
    hash: async plain => `hashed:${plain}`,
    compare: async (plain, hash) => {
      compares += 1;
      return hash === `hashed:${plain}`;
    }
  }
});

const { createApp } = await import('../src/app.mjs');
const { resetRateLimits } = await import('../src/rate-limit.mjs');

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

test.beforeEach(() => {
  db.reset();
  resetRateLimits();
  compares = 0;
});

const USER = '11111111-1111-4111-8111-111111111111';

function cookieFor({ userId = USER, loginType = 'user', ver } = {}) {
  const payload = { sub: userId, loginType };

  if (ver !== undefined) {
    payload.ver = ver;
  }

  return `et_session=${jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '1h' })}`;
}

/** The account as requireAuth loads it: session version plus flags. */
function account({ version = 0, flags = {} } = {}) {
  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: version, has_settings: USER, ...settingsRow(flags) }
  ]);
}

async function call(method, path, { cookie, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers
  };
}

/** The `ver` claim of the session cookie a response set, if it set one. */
function issuedVersion(response) {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const token = /et_session=([^;]+)/.exec(setCookie)?.[1];

  return token ? jwt.decode(token).ver : undefined;
}

// ------------------------------------------------------------- sessions (H2)

test('a session whose version matches the account is accepted', async () => {
  account({ version: 3 });
  db.on(/from balances/, () => []);

  const result = await call('GET', '/api/balances', { cookie: cookieFor({ ver: 3 }) });

  assert.equal(result.status, 200);
});

test('a revoked session is refused, even with a valid signature', async () => {
  account({ version: 4 });

  const result = await call('GET', '/api/balances', { cookie: cookieFor({ ver: 3 }) });

  assert.equal(result.status, 401);
});

test('a cookie from before versions existed counts as version 0', async () => {
  account({ version: 0 });
  db.on(/from balances/, () => []);

  assert.equal((await call('GET', '/api/balances', { cookie: cookieFor() })).status, 200);

  account({ version: 1 });
  assert.equal((await call('GET', '/api/balances', { cookie: cookieFor() })).status, 401);
});

test('a session for a deleted account is refused', async () => {
  db.on(/from users u\s+left join user_settings/, () => []);

  const result = await call('GET', '/api/expenses', { cookie: cookieFor() });

  assert.equal(result.status, 401);
});

test('/me does not report a revoked session as signed in', async () => {
  account({ version: 2 });

  const result = await call('GET', '/api/auth/me', { cookie: cookieFor({ ver: 1 }) });

  assert.equal(result.status, 401);
});

test('a token signed with another algorithm is refused', async () => {
  account();
  const forged = jwt.sign({ sub: USER, loginType: 'admin' }, SECRET, { algorithm: 'HS512' });

  const result = await call('GET', '/api/balances', { cookie: `et_session=${forged}` });

  assert.equal(result.status, 401);
});

test('changing the password revokes other sessions and keeps this one', async () => {
  account({ version: 0 });
  db.on(/select password_hash, admin_password_hash from users/, () => [
    { password_hash: 'hashed:old-password', admin_password_hash: null }
  ]);
  db.on(/update users set password_hash/, () => []);
  db.on(/set session_version = session_version \+ 1/, () => [{ session_version: 1 }]);

  const result = await call('PUT', '/api/auth/password', {
    cookie: cookieFor({ ver: 0 }),
    body: { currentPassword: 'old-password', newPassword: 'new-password-1' }
  });

  assert.equal(result.status, 200);
  assert.equal(db.ran(/session_version = session_version \+ 1/).length, 1);
  assert.equal(issuedVersion(result), 1, 'this device gets a cookie for the new version');
});

test('changing the full-access password revokes other sessions', async () => {
  account({ version: 5 });
  db.on(/select password_hash, admin_password_hash from users/, () => [
    { password_hash: 'hashed:account-pass', admin_password_hash: 'hashed:old-full-pass' }
  ]);
  db.on(/update users set admin_password_hash/, () => []);
  db.on(/set session_version = session_version \+ 1/, () => [{ session_version: 6 }]);

  const result = await call('PUT', '/api/auth/admin-password', {
    cookie: cookieFor({ loginType: 'admin', ver: 5 }),
    body: { adminPassword: 'new-full-pass' }
  });

  assert.equal(result.status, 200);
  assert.equal(issuedVersion(result), 6);
});

test('removing the full-access password revokes other sessions', async () => {
  account({ version: 0 });
  db.on(/select admin_password_hash from users/, () => [
    { admin_password_hash: 'hashed:full-pass' }
  ]);
  db.on(/update users set admin_password_hash = null/, () => []);
  db.on(/delete from user_settings/, () => []);
  db.on(/insert into user_settings/, () => []);
  db.on(/set session_version = session_version \+ 1/, () => [{ session_version: 1 }]);

  const result = await call('POST', '/api/auth/admin-password/remove', {
    cookie: cookieFor({ loginType: 'admin' }),
    body: { adminPassword: 'full-pass' }
  });

  assert.equal(result.status, 200);
  assert.equal(issuedVersion(result), 1);
});

// --------------------------------------------------------- login (M4, M5, M7)

test('an unknown email costs as many comparisons as a wrong password', async () => {
  db.on(/from users where email/, () => []);
  await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'x' } });
  const unknown = compares;

  compares = 0;
  db.on(/from users where email/, () => [{
    id: USER, name: 'Asha', email: 'asha@example.com', created_at: null, session_version: 0,
    password_hash: 'hashed:right', admin_password_hash: null
  }]);
  await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'wrong' } });

  assert.equal(unknown, compares);
  assert.equal(unknown, 2);
});

test('a sign-in carries the account session version in its cookie', async () => {
  db.on(/from users where email/, () => [{
    id: USER, name: 'Asha', email: 'asha@example.com', created_at: null, session_version: 7,
    password_hash: 'hashed:right-password', admin_password_hash: null
  }]);

  const result = await call('POST', '/api/auth/login', {
    body: { email: 'asha@example.com', password: 'right-password' }
  });

  assert.equal(result.status, 200);
  assert.equal(issuedVersion(result), 7);
});

test('one address cannot work through a list of emails', async () => {
  db.on(/from users where email/, () => []);

  const statuses = [];

  for (let i = 0; i < 31; i += 1) {
    const result = await call('POST', '/api/auth/login', {
      body: { email: `person${i}@example.com`, password: 'guess' }
    });

    statuses.push(result.status);
  }

  assert.deepEqual(statuses.slice(0, 30), Array(30).fill(401));
  assert.equal(statuses[30], 429);
});

test('a new password needs eight characters; signing in with an old shorter one still works', async () => {
  const short = await call('POST', '/api/auth/register', {
    body: { name: 'Asha K', email: 'asha@example.com', password: 'seven77' }
  });

  assert.equal(short.status, 400);
  assert.match(short.body.error, /at least 8/);

  db.on(/from users where email/, () => [{
    id: USER, name: 'Asha', email: 'asha@example.com', created_at: null, session_version: 0,
    password_hash: 'hashed:six666', admin_password_hash: null
  }]);

  const login = await call('POST', '/api/auth/login', {
    body: { email: 'asha@example.com', password: 'six666' }
  });

  assert.equal(login.status, 200);
});

// ------------------------------------------------- restricted sessions (M6)

test('changing the sign-in email needs a password', async () => {
  account();
  db.on(/select email, password_hash, admin_password_hash from users/, () => [
    { email: 'asha@example.com', password_hash: 'hashed:account-pass', admin_password_hash: null }
  ]);
  db.on(/select 1 from users where email/, () => []);
  db.on(/update users\s+set name/, () => [
    { id: USER, name: 'Asha K', email: 'new@example.com', admin_password_hash: null, created_at: null }
  ]);

  const refused = await call('PATCH', '/api/auth/profile', {
    cookie: cookieFor(),
    body: { name: 'Asha K', email: 'new@example.com' }
  });

  assert.equal(refused.status, 403);
  assert.equal(db.ran(/update users\s+set name/).length, 0);

  const allowed = await call('PATCH', '/api/auth/profile', {
    cookie: cookieFor(),
    body: { name: 'Asha K', email: 'new@example.com', currentPassword: 'account-pass' }
  });

  assert.equal(allowed.status, 200);
});

test('renaming without changing the email needs no password', async () => {
  account();
  db.on(/select email, password_hash, admin_password_hash from users/, () => [
    { email: 'asha@example.com', password_hash: 'hashed:account-pass', admin_password_hash: null }
  ]);
  db.on(/select 1 from users where email/, () => []);
  db.on(/update users\s+set name/, () => [
    { id: USER, name: 'Asha Kumar', email: 'asha@example.com', admin_password_hash: null, created_at: null }
  ]);

  const result = await call('PATCH', '/api/auth/profile', {
    cookie: cookieFor(),
    body: { name: 'Asha Kumar', email: 'asha@example.com' }
  });

  assert.equal(result.status, 200);
});

test('with a full-access password set, only it can delete the account', async () => {
  account();
  db.on(/select password_hash, admin_password_hash from users/, () => [
    { password_hash: 'hashed:account-pass', admin_password_hash: 'hashed:full-pass' }
  ]);
  db.on(/delete from users/, () => []);

  const withNormal = await call('DELETE', '/api/auth/account', {
    cookie: cookieFor(),
    body: { password: 'account-pass' }
  });

  assert.equal(withNormal.status, 403);
  assert.equal(db.ran(/delete from users/).length, 0);

  const withFull = await call('DELETE', '/api/auth/account', {
    cookie: cookieFor(),
    body: { password: 'full-pass' }
  });

  assert.equal(withFull.status, 200);
  assert.equal(db.ran(/delete from users/).length, 1);
});

test('without a full-access password, the account password deletes the account', async () => {
  account();
  db.on(/select password_hash, admin_password_hash from users/, () => [
    { password_hash: 'hashed:account-pass', admin_password_hash: null }
  ]);
  db.on(/delete from users/, () => []);

  const result = await call('DELETE', '/api/auth/account', {
    cookie: cookieFor(),
    body: { password: 'account-pass' }
  });

  assert.equal(result.status, 200);
});

test('seeing balances is not enough to retype one', async () => {
  account({ flags: { balance_user_access: true, expense_user_access: false } });
  db.on(/update balances/, () => []);

  const result = await call('PUT', `/api/balances/${USER}`, {
    cookie: cookieFor(),
    body: { type: 'Bank Account', category: 'HDFC Bank', balance: 999999 }
  });

  assert.equal(result.status, 403);
  assert.equal(db.ran(/update balances/).length, 0);
});

test('a full-access session may still manage balances', async () => {
  account({ flags: { balance_user_access: false, expense_user_access: false } });
  db.on(/update balances/, () => [
    { id: USER, type: 'Bank Account', category: 'HDFC Bank', balance: 10, saved: true }
  ]);

  const result = await call('PUT', `/api/balances/${USER}`, {
    cookie: cookieFor({ loginType: 'admin' }),
    body: { type: 'Bank Account', category: 'HDFC Bank', balance: 10 }
  });

  assert.equal(result.status, 200);
});

test('income on another day needs "Change transaction dates"', async () => {
  account({ flags: { update_permission_user: false } });
  db.on(/from balances/, () => []);

  const result = await call('POST', '/api/incomes', {
    cookie: cookieFor(),
    body: {
      amount: 500, description: 'Refund', date: '2020-01-01',
      targetId: USER, tzOffset: -330
    }
  });

  assert.equal(result.status, 403);
  assert.equal(db.ran(/insert into incomes/).length, 0);
});

test('income for today goes through without that permission', async () => {
  account({ flags: { update_permission_user: false } });
  db.on(/from balances\s+where id = \$1 and user_id = \$2 and saved = true/, () => [
    { id: USER, type: 'Bank Account', category: 'HDFC Bank', balance: 100 }
  ]);
  db.on(/update balances set balance = balance \+/, () => [{ balance: 600 }]);
  db.on(/insert into incomes/, params => [{
    id: USER, amount: params[1], description: params[2], received_on: params[3],
    category: null, target_id: USER, target_type: 'Bank Account',
    target_category: 'HDFC Bank', balance_updated: true, source_channel: 'web',
    created_at: null, split_expense_id: null
  }]);

  // What the caller's clock says today is, at -330 minutes (India).
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  const result = await call('POST', '/api/incomes', {
    cookie: cookieFor(),
    body: { amount: 500, description: 'Refund', date: today, targetId: USER, tzOffset: -330 }
  });

  assert.equal(result.status, 201);
});

// -------------------------------------------------------- input (L1) and M2

test('a malformed amount is a 400, not a database error', async () => {
  account();

  for (const amount of [true, [5], '0x10', 0.001]) {
    const result = await call('POST', '/api/expenses', {
      cookie: cookieFor(),
      body: { amount, description: 'Tea', date: '2026-01-01' }
    });

    assert.equal(result.status, 400, `amount ${JSON.stringify(amount)}`);
  }

  assert.equal(db.ran(/insert into expenses/).length, 0);
});

test('API responses are never stored by a cache', async () => {
  account();
  db.on(/from balances/, () => []);

  const signedIn = await call('GET', '/api/balances', { cookie: cookieFor() });
  const signedOut = await call('GET', '/api/auth/me');

  assert.equal(signedIn.headers.get('cache-control'), 'no-store');
  assert.equal(signedOut.headers.get('cache-control'), 'no-store');
});

// ------------------------------------------------------------------- M3

test('a request reads the settings once, and writes nothing to do it', async () => {
  account();
  db.on(/from balances/, () => []);

  await call('GET', '/api/balances', { cookie: cookieFor() });

  assert.equal(db.ran(/insert into user_settings/).length, 0);
  assert.equal(db.ran(/from user_settings where user_id/).length, 0, 'flags came with the session');
});
