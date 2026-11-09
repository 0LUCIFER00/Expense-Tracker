/**
 * Receipt attachments through the real routes, with the database and the file
 * store both stood in: sign-in, ownership, file checks, the per-expense limit,
 * upload failures and their cleanup, preview and download, removal of one file
 * without touching the others or the expense, and no financial writes.
 *
 * Real storage and Postgres are exercised by the end-to-end run in
 * RECEIPT_ATTACHMENTS_REPORT.md. Run with --experimental-test-module-mocks.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createFakeDb, settingsRow } from './helpers/fake-db.mjs';
import * as files from './helpers/sample-files.mjs';

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long';

process.env['JWT_SECRET'] = SECRET;
process.env['DATABASE_URL'] = 'postgres://nobody@127.0.0.1:1/never';

const db = createFakeDb();

/** The file store, recording every call; each can be made to fail. */
const storage = { puts: [], gets: [], deletes: [], failPut: false, failDelete: false, files: new Map() };

mock.module('../src/db.mjs', {
  namedExports: { query: db.query, transaction: db.transaction, pool: db.pool, closePool: db.closePool }
});

mock.module('../src/attachment-storage.mjs', {
  namedExports: {
    isConfigured: () => true,
    putFile: async (key, buffer, type) => {
      if (storage.failPut) throw new Error('storage down');
      storage.puts.push({ key, size: buffer.length, type });
      storage.files.set(key, buffer);
    },
    getFile: async key => {
      storage.gets.push(key);
      const buf = storage.files.get(key);
      return buf ? new Blob([buf]).stream() : null;
    },
    deleteFile: async key => {
      if (storage.failDelete) throw new Error('storage down');
      storage.deletes.push(key);
      storage.files.delete(key);
    }
  }
});

const { createApp } = await import('../src/app.mjs');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => {
  db.reset();
  Object.assign(storage, { puts: [], gets: [], deletes: [], failPut: false, failDelete: false, files: new Map() });
});

const USER = '77777777-7777-4777-8777-777777777777';
const EXPENSE = '88888888-8888-4888-8888-888888888888';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ATT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY = `receipts/${USER}/${EXPENSE}/11111111-1111-4111-8111-111111111111.jpg`;

/** Any write to a money table. */
const MONEY = /\b(insert into|update|delete from)\s+(expenses|incomes|balances|monthly_budgets|category_budgets|budget_alerts|account_transfers|savings_goals)\b/;

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

function account(flags = {}) {
  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow(flags) }
  ]);
}

function upload(buf, name = 'receipt.jpg', expenseId = EXPENSE) {
  return fetch(`${base}/api/expenses/${expenseId}/attachments`, {
    method: 'POST',
    headers: { cookie: cookie(), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    body: buf
  }).then(async r => ({ status: r.status, body: await r.json() }));
}

/** The expense is the user's, has `count` attachments, and inserts succeed. */
function owned({ count = 0, insertFails = false } = {}) {
  db.on(/select id from expenses where id = \$1 and user_id = \$2/, params => params[1] === USER && params[0] === EXPENSE ? [{ id: EXPENSE }] : []);
  db.on(/select count\(\*\)::int as count from receipt_attachments/, () => [{ count }]);
  db.on(/insert into receipt_attachments/, params => {
    if (insertFails) throw new Error('database down');
    return [{ id: ATT, expense_id: params[1], file_name: params[3], content_type: params[4], size_bytes: params[5], created_at: 'now' }];
  });
  db.on(/delete from attachment_cleanup/, () => []);
  db.on(/insert into attachment_cleanup/, () => []);
}

function noMoneyWrites() {
  assert.equal(db.calls.filter(c => MONEY.test(c.text)).length, 0, 'no balance, expense, income, budget or transfer write');
}

test('attachments need a sign-in', async () => {
  const res = await fetch(`${base}/api/expenses/${EXPENSE}/attachments`);
  assert.equal(res.status, 401);
});

test('an image is stored privately under a server-made key and recorded', async () => {
  account();
  owned();

  const res = await upload(files.jpeg(), '../../evil/Swiggy bill.exe');

  assert.equal(res.status, 201);
  assert.equal(storage.puts.length, 1);
  assert.match(storage.puts[0].key, new RegExp(`^receipts/${USER}/${EXPENSE}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(storage.puts[0].type, 'image/jpeg');
  assert.equal(res.body.fileName, 'Swiggy bill.jpg', 'no folders, real extension');
  assert.equal(res.body.contentType, 'image/jpeg');
  assert.match(db.ran(/for no key update/)[0].text, /from expenses/);
  noMoneyWrites();
});

test('PNG, WebP and PDF are accepted too', async () => {
  for (const [buf, type] of [[files.png(), 'image/png'], [files.webp(), 'image/webp'], [files.pdf(), 'application/pdf']]) {
    db.reset();
    account();
    owned();
    const res = await upload(buf, 'invoice');
    assert.equal(res.status, 201, type);
    assert.equal(res.body.contentType, type);
  }
});

test('wrong types, damaged files and empty bodies are refused before storage', async () => {
  account();
  owned();

  for (const [buf, status] of [
    [files.gif(), 415], [files.htmlAsJpeg(), 415], [files.exe(), 415],
    [files.truncatedJpeg(), 415], [files.truncatedPdf(), 415], [Buffer.alloc(0), 400]
  ]) {
    assert.equal((await upload(buf)).status, status);
  }

  assert.equal(storage.puts.length, 0);
  assert.equal(db.ran(/insert into receipt_attachments/).length, 0);
});

test('a file over 4 MB is refused with a clear message', async () => {
  account();
  owned();

  const res = await upload(Buffer.concat([files.jpeg(4 * 1024 * 1024)]));

  assert.equal(res.status, 413);
  assert.match(res.body.error, /up to 4 MB/);
  assert.equal(storage.puts.length, 0);
});

test("someone else's expense (or none) is not found, and nothing is stored", async () => {
  account();
  owned();

  const res = await upload(files.jpeg(), 'r.jpg', OTHER);

  assert.equal(res.status, 404);
  assert.equal(storage.puts.length, 0);
  for (const call of db.ran(/from expenses/)) {
    assert.ok(call.params.includes(USER), 'looked up under the signed-in user');
  }
});

test('an expense holds at most 10 attachments', async () => {
  account();
  owned({ count: 10 });

  const res = await upload(files.jpeg());

  assert.equal(res.status, 409);
  assert.equal(storage.puts.length, 0);
});

test('if the row cannot be written, the stored file is deleted again', async () => {
  account();
  owned({ insertFails: true });

  const res = await upload(files.jpeg());

  assert.equal(res.status, 500);
  assert.equal(storage.puts.length, 1);
  assert.deepEqual(storage.deletes, [storage.puts[0].key], 'no file left without a row');
});

test('if storage is down, nothing is recorded', async () => {
  account();
  owned();
  storage.failPut = true;

  const res = await upload(files.jpeg());

  assert.equal(res.status, 502);
  assert.equal(db.ran(/insert into receipt_attachments/).length, 0);
});

test('listing shows only that expense\'s attachments, for its owner', async () => {
  account();
  owned();
  db.on(/from receipt_attachments\s+where expense_id = \$1 and user_id = \$2/, () => [
    { id: ATT, expense_id: EXPENSE, file_name: 'a.jpg', content_type: 'image/jpeg', size_bytes: 10, created_at: 'now' }
  ]);

  const mine = await fetch(`${base}/api/expenses/${EXPENSE}/attachments`, { headers: { cookie: cookie() } });
  const theirs = await fetch(`${base}/api/expenses/${OTHER}/attachments`, { headers: { cookie: cookie() } });

  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).length, 1);
  assert.equal(theirs.status, 404);
});

function stored(row = {}) {
  storage.files.set(KEY, files.jpeg());
  db.on(/storage_key from receipt_attachments\s+where id = \$1 and expense_id = \$2 and user_id = \$3/, params =>
    params[2] === USER && params[0] === ATT && params[1] === EXPENSE
      ? [{ id: ATT, expense_id: EXPENSE, file_name: 'Bill (Nov).jpg', content_type: 'image/jpeg', size_bytes: files.jpeg().length, created_at: 'now', storage_key: KEY, ...row }]
      : []);
}

test('preview streams the file inline, framable only by this site', async () => {
  account();
  stored();

  const res = await fetch(`${base}/api/expenses/${EXPENSE}/attachments/${ATT}`, { headers: { cookie: cookie() } });
  const body = Buffer.from(await res.arrayBuffer());

  assert.equal(res.status, 200);
  assert.deepEqual(body, files.jpeg());
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('content-disposition'), /^inline; filename="Bill \(Nov\).jpg"/);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('?download=1 asks the browser to save it', async () => {
  account();
  stored();

  const res = await fetch(`${base}/api/expenses/${EXPENSE}/attachments/${ATT}?download=1`, { headers: { cookie: cookie() } });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
});

test("another user's attachment, or one from a different expense, is not found and never read", async () => {
  account();
  stored();

  for (const path of [`${OTHER}/attachments/${ATT}`, `${EXPENSE}/attachments/${OTHER}`, `${EXPENSE}/attachments/not-an-id`]) {
    const res = await fetch(`${base}/api/expenses/${path}`, { headers: { cookie: cookie() } });
    assert.equal(res.status, 404, path);
  }

  assert.equal(storage.gets.length, 0);
});

test('removing one attachment deletes that row and file only; the expense is untouched', async () => {
  account();
  db.on(/delete from receipt_attachments\s+where id = \$1 and expense_id = \$2 and user_id = \$3/, params =>
    params[0] === ATT && params[2] === USER ? [{ storage_key: KEY }] : []);
  db.on(/delete from attachment_cleanup/, () => []);

  const res = await fetch(`${base}/api/expenses/${EXPENSE}/attachments/${ATT}`, { method: 'DELETE', headers: { cookie: cookie() } });

  assert.equal(res.status, 204);
  assert.deepEqual(storage.deletes, [KEY]);
  assert.equal(db.ran(/delete from receipt_attachments/).length, 1);
  assert.deepEqual(db.ran(/delete from attachment_cleanup/)[0].params, [KEY]);
  noMoneyWrites();
});

test('a storage failure while removing still removes the row and leaves the file queued for the daily job', async () => {
  account();
  storage.failDelete = true;
  db.on(/delete from receipt_attachments/, () => [{ storage_key: KEY }]);
  db.on(/update attachment_cleanup set attempts/, () => []);

  const res = await fetch(`${base}/api/expenses/${EXPENSE}/attachments/${ATT}`, { method: 'DELETE', headers: { cookie: cookie() } });

  assert.equal(res.status, 204);
  assert.equal(db.ran(/update attachment_cleanup set attempts/).length, 1);
});

test('removing needs "Remove entries"; the full-access sign-in always may', async () => {
  account({ remove_permission_user: false });
  const refused = await fetch(`${base}/api/expenses/${EXPENSE}/attachments/${ATT}`, { method: 'DELETE', headers: { cookie: cookie() } });
  assert.equal(refused.status, 403);
  assert.equal(db.ran(/delete from receipt_attachments/).length, 0);

  db.on(/delete from receipt_attachments/, () => [{ storage_key: KEY }]);
  db.on(/delete from attachment_cleanup/, () => []);
  const allowed = await fetch(`${base}/api/expenses/${EXPENSE}/attachments/${ATT}`, { method: 'DELETE', headers: { cookie: cookie('admin') } });
  assert.equal(allowed.status, 204);
});

test("another user's attachment cannot be removed", async () => {
  account();
  db.on(/delete from receipt_attachments/, () => []);

  const res = await fetch(`${base}/api/expenses/${OTHER}/attachments/${ATT}`, { method: 'DELETE', headers: { cookie: cookie() } });

  assert.equal(res.status, 404);
  assert.equal(db.ran(/delete from receipt_attachments/)[0].params[2], USER);
  assert.equal(storage.deletes.length, 0);
});

test('the expense list carries how many attachments each expense has', async () => {
  account();
  db.on(/from expenses\s+where user_id = \$1/, () => [{
    id: EXPENSE, amount: 100, description: 'Lunch', spent_on: '2026-11-09', status: 'done', attachment_count: 2
  }]);

  const res = await fetch(`${base}/api/expenses`, { headers: { cookie: cookie() } });
  const [row] = await res.json();

  assert.equal(row.attachmentCount, 2);
  assert.match(db.ran(/from expenses/)[0].text, /from receipt_attachments a\s+where a.expense_id = expenses.id/);
});
