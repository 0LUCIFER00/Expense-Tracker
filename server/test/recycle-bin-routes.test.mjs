/**
 * Recently deleted through the real routes, against a stand-in database that
 * keeps accounts, expenses, incomes and receipts in memory: removing moves an
 * entry to the bin and puts its money back; restoring puts the money back in
 * play exactly once; deleting for good removes only binned rows and audits
 * them; permissions and ownership hold; and every list and total leaves
 * binned rows out.
 *
 * Real locking is exercised against Postgres in the end-to-end run described
 * in RECYCLE_BIN_REPORT.md. Run with --experimental-test-module-mocks.
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
const { daysLeft, purgeExpired, RETENTION_DAYS } = await import('../src/recycle-store.mjs');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());
test.beforeEach(() => db.reset());

const USER = '77777777-7777-4777-8777-777777777777';
const BANK = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASH = '0ccccccc-cccc-4ccc-8ccc-cccccccccccc';
const E1 = '1eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const E2 = '1eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const SPLIT = '1eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
const I1 = '2iiiiiii-iiii-4iii-8iii-iiiiiiiiiii1'.replace(/i/g, 'b');
const R1 = '2iiiiiii-iiii-4iii-8iii-iiiiiiiiiii2'.replace(/i/g, 'c');
const NOBODY = '9fffffff-ffff-4fff-8fff-ffffffffffff';

const DELETED = '2026-11-01T10:00:00.000Z';

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

async function call(method, path, { body, loginType = 'user' } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookie(loginType) },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: res.status, body: await res.json() };
}

const binned = (extra = {}) => ({ deleted_at: DELETED, deleted_by: USER, deleted_via: 'user', delete_reversed: true, ...extra });
const live = { deleted_at: null, deleted_by: null, deleted_via: null, delete_reversed: null };

/**
 * An in-memory ledger behind the SQL that removing, restoring and purging run.
 * Rows belong to USER unless they say otherwise.
 */
function ledger({ flags = {}, expenses = [], incomes = [], balances = null } = {}) {
  const state = {
    balances: balances ?? {
      [BANK]: { id: BANK, user_id: USER, category: 'HDFC Bank', balance: 1000 },
      [CASH]: { id: CASH, user_id: USER, category: 'Cash', balance: 100 }
    },
    expenses: expenses.map(e => ({ user_id: USER, status: 'done', split_members: null, ...live, ...e })),
    incomes: incomes.map(i => ({ user_id: USER, split_expense_id: null, ...live, ...i })),
    attachments: [{ id: 'a1', expense_id: E2 }],
    purges: []
  };

  const mine = (rows, id, user) => rows.find(r => r.id === id && r.user_id === user);

  db.on(/from users u\s+left join user_settings/, () => [
    { session_version: 0, has_settings: USER, ...settingsRow(flags) }
  ]);
  db.on(/from monthly_budgets/, () => []);

  // ---- removing
  db.on(/from expenses\s+where id = \$1 and user_id = \$2 and deleted_at is null\s+for update/, ([id, user]) => {
    const e = mine(state.expenses, id, user);
    return e && !e.deleted_at ? [{ ...e }] : [];
  });
  db.on(/from incomes\s+where id = \$1 and user_id = \$2 and deleted_at is null\s+for update/, ([id, user]) => {
    const i = mine(state.incomes, id, user);
    return i && !i.deleted_at ? [{ ...i }] : [];
  });
  db.on(/select count\(\*\)::int as n from incomes\s+where split_expense_id = \$1 and deleted_at is null/, ([id]) =>
    [{ n: state.incomes.filter(i => i.split_expense_id === id && !i.deleted_at).length }]);
  db.on(/update (expenses|incomes)\s+set deleted_at = now\(\), deleted_by = \$2, deleted_via = \$3, delete_reversed = \$4/, (params, text) => {
    const rows = /update expenses/.test(text) ? state.expenses : state.incomes;
    Object.assign(rows.find(r => r.id === params[0]), {
      deleted_at: new Date().toISOString(), deleted_by: params[1], deleted_via: params[2], delete_reversed: params[3]
    });
    return [];
  });

  // ---- money
  db.on(/select balance from balances where id = \$1 and user_id = \$2 for update/, ([id, user]) => {
    const b = state.balances[id];
    return b && b.user_id === user ? [{ balance: b.balance }] : [];
  });
  db.on(/update balances set balance = balance \+ \$1\s+where id = \$2 and user_id = \$3\s+returning balance/, ([amount, id, user]) => {
    const b = state.balances[id];
    if (!b || b.user_id !== user) return [];
    b.balance = Math.round((b.balance + Number(amount)) * 100) / 100;
    assert.ok(b.balance >= 0, 'a balance went below zero');
    return [{ balance: b.balance }];
  });
  db.on(/update balances set balance = balance - \$1\s+where id = \$2 and user_id = \$3\s+returning balance/, ([amount, id, user]) => {
    const b = state.balances[id];
    if (!b || b.user_id !== user) return [];
    b.balance = Math.round((b.balance - Number(amount)) * 100) / 100;
    assert.ok(b.balance >= 0, 'a balance went below zero');
    return [{ balance: b.balance }];
  });

  // ---- restoring
  db.on(/delete_reversed\s+from expenses\s+where id = \$1 and user_id = \$2 and loan_repayment_id is null\s+for update/, ([id, user]) => {
    const e = mine(state.expenses, id, user);
    return e ? [{ ...e }] : [];
  });
  db.on(/select split_expense_id from incomes where id = \$1 and user_id = \$2/, ([id, user]) => {
    const i = mine(state.incomes, id, user);
    return i ? [{ split_expense_id: i.split_expense_id }] : [];
  });
  db.on(/from expenses\s+where id = \$1 and user_id = \$2 and split_members is not null and deleted_at is null\s+for update/, ([id, user]) => {
    const e = mine(state.expenses, id, user);
    return e && e.split_members && !e.deleted_at ? [{ ...e }] : [];
  });
  db.on(/select coalesce\(sum\(amount\), 0\) as received from incomes\s+where split_expense_id = \$1 and deleted_at is null/, ([id]) =>
    [{ received: state.incomes.filter(i => i.split_expense_id === id && !i.deleted_at).reduce((s, i) => s + i.amount, 0) }]);
  db.on(/select description, deleted_at from expenses where id = \$1 and user_id = \$2/, ([id, user]) => {
    const e = mine(state.expenses, id, user);
    return e ? [{ description: e.description, deleted_at: e.deleted_at }] : [];
  });
  db.on(/delete_reversed\s+from incomes\s+where id = \$1 and user_id = \$2 and loan_repayment_id is null\s+for update/, ([id, user]) => {
    const i = mine(state.incomes, id, user);
    return i ? [{ ...i }] : [];
  });
  db.on(/update (expenses|incomes) set deleted_at = null/, ([id], text) => {
    const rows = /update expenses/.test(text) ? state.expenses : state.incomes;
    Object.assign(rows.find(r => r.id === id), live);
    return [];
  });

  // ---- deleting for good
  db.on(/delete from (expenses|incomes)\s+where deleted_at is not null and /, (params, text) => {
    const isExpense = /delete from expenses/.test(text);
    const rows = isExpense ? state.expenses : state.incomes;
    let gone;

    if (/id = \$1 and user_id = \$2/.test(text)) {
      gone = rows.filter(r => r.deleted_at && r.id === params[0] && r.user_id === params[1]);
    } else if (/deleted_at < coalesce\(\$1::timestamptz, now\(\)\) - interval '30 days'/.test(text)) {
      const cutoff = new Date((params[0] ?? new Date()).getTime() - 30 * 86_400_000);
      gone = rows.filter(r => r.deleted_at && new Date(r.deleted_at) < cutoff).slice(0, params[1]);
    } else {
      gone = rows.filter(r => r.deleted_at && r.user_id === params[0]);
    }

    for (const row of gone) {
      rows.splice(rows.indexOf(row), 1);

      if (isExpense) {
        // What the database's foreign keys do.
        state.attachments = state.attachments.filter(a => a.expense_id !== row.id);
        for (const i of state.incomes) if (i.split_expense_id === row.id) i.split_expense_id = null;
      }
    }

    return gone.map(r => ({ id: r.id, user_id: r.user_id, amount: r.amount, entry_date: r.date, deleted_at: r.deleted_at }));
  });
  db.on(/insert into transaction_purges/, params => {
    params[3].forEach((entryId, n) => state.purges.push({
      kind: params[0], reason: params[1], user_id: params[2][n], entry_id: entryId, amount_paise: params[4][n]
    }));
    return [];
  });
  db.on(/select 1 from (expenses|incomes) where id = \$1 and user_id = \$2/, ([id, user], text) => {
    const rows = /from expenses/.test(text) ? state.expenses : state.incomes;
    return mine(rows, id, user) ? [{ '?column?': 1 }] : [];
  });

  // ---- the list
  db.on(/from expenses e\s+where e.user_id = \$1 and e.deleted_at is not null/, ([user]) => [
    ...state.expenses.filter(e => e.user_id === user && e.deleted_at).map(e => ({
      kind: 'expense', id: e.id, description: e.description, amount: e.amount, date: e.date, category: e.category ?? null,
      account: e.source_category ?? null, status: e.status, deleted_at: e.deleted_at, deleted_via: e.deleted_via,
      delete_reversed: e.delete_reversed, split_members: e.split_members, repays: null,
      attachments: state.attachments.filter(a => a.expense_id === e.id).length
    })),
    ...state.incomes.filter(i => i.user_id === user && i.deleted_at).map(i => ({
      kind: 'income', id: i.id, description: i.description, amount: i.amount, date: i.date, category: null,
      account: i.target_category ?? null, status: 'done', deleted_at: i.deleted_at, deleted_via: i.deleted_via,
      delete_reversed: i.delete_reversed, split_members: null,
      repays: state.expenses.find(e => e.id === i.split_expense_id)?.description ?? null, attachments: 0
    }))
  ].sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1)));

  return state;
}

const lunch = { id: E1, amount: 250, description: 'Lunch', date: '2026-10-30', spent_on: '2026-10-30', source_id: BANK, source_category: 'HDFC Bank', balance_updated: true };
const shoes = { id: E2, amount: 900, description: 'Shoes', date: '2026-10-31', spent_on: '2026-10-31', source_id: BANK, source_category: 'HDFC Bank', balance_updated: true };
const salary = { id: I1, amount: 500, description: 'Salary', date: '2026-10-29', received_on: '2026-10-29', target_id: CASH, target_category: 'Cash', balance_updated: true };

// ------------------------------------------------------------- removing

test('removing an expense puts its money back and moves it to Recently deleted, keeping the row', async () => {
  const state = ledger({ expenses: [lunch] });

  const { status, body } = await call('DELETE', `/api/expenses/${E1}`);

  assert.equal(status, 200);
  assert.equal(body.refunded, true);
  assert.equal(body.recentlyDeleted, true);
  assert.equal(state.balances[BANK].balance, 1250);
  assert.equal(state.expenses.length, 1, 'the row is kept');
  assert.equal(state.expenses[0].deleted_via, 'user');
  assert.equal(state.expenses[0].delete_reversed, true);
  assert.equal(db.ran(/delete from expenses/).length, 0);
});

test('removing with the full-access sign-in is recorded as such', async () => {
  const state = ledger({ expenses: [lunch] });

  await call('DELETE', `/api/expenses/${E1}`, { loginType: 'admin' });

  assert.equal(state.expenses[0].deleted_via, 'admin');
});

test('a pending expense is removed without moving money, and comes back pending', async () => {
  const state = ledger({ expenses: [{ ...lunch, status: 'pending', balance_updated: false }] });

  await call('DELETE', `/api/expenses/${E1}`);
  assert.equal(state.expenses[0].delete_reversed, false);
  assert.equal(state.balances[BANK].balance, 1000);

  const { status } = await call('POST', `/api/recycle-bin/expense/${E1}/restore`);
  assert.equal(status, 200);
  assert.equal(state.expenses[0].status, 'pending');
  assert.equal(state.expenses[0].deleted_at, null);
  assert.equal(state.balances[BANK].balance, 1000);
});

test('removing income takes it back out, or refuses when the account no longer holds it', async () => {
  // Cash holds ₹100; taking back ₹500 would go below zero, so it is refused and stays.
  let state = ledger({ incomes: [salary] });

  const refused = await call('DELETE', `/api/incomes/${I1}`);
  assert.equal(refused.status, 409);
  assert.equal(state.incomes[0].deleted_at, null);
  assert.equal(state.balances[CASH].balance, 100);

  db.reset();
  state = ledger({ incomes: [salary], balances: {
    [CASH]: { id: CASH, user_id: USER, category: 'Cash', balance: 800 }
  } });

  const { status, body } = await call('DELETE', `/api/incomes/${I1}`);
  assert.equal(status, 200);
  assert.equal(body.reversed, true);
  assert.equal(state.balances[CASH].balance, 300);
  assert.equal(state.incomes[0].delete_reversed, true);
  assert.equal(state.incomes[0].deleted_via, 'user');
});

test('an entry already in Recently deleted cannot be removed again', async () => {
  ledger({ expenses: [{ ...lunch, ...binned() }] });

  const { status } = await call('DELETE', `/api/expenses/${E1}`);

  assert.equal(status, 404);
});

// ------------------------------------------------------------- listing

test('the list shows what is binned with days left, and the normal lists leave it out', async () => {
  ledger({ expenses: [{ ...shoes, ...binned() }], incomes: [salary] });

  const { status, body } = await call('GET', '/api/recycle-bin');

  assert.equal(status, 200);
  assert.equal(body.retentionDays, 30);
  assert.equal(body.canManage, true);
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].description, 'Shoes');
  assert.equal(body.entries[0].amountPaise, 90000);
  assert.equal(body.entries[0].account, 'HDFC Bank');
  assert.equal(body.entries[0].attachmentCount, 1);
  assert.equal(body.entries[0].daysLeft, daysLeft(DELETED));
  assert.equal(new Date(body.entries[0].expiresAt) - new Date(DELETED), 30 * 86_400_000);

  // The SQL of every list and total skips deleted rows.
  db.on(/from expenses\s+where user_id = \$1 and deleted_at is null/, () => []);
  db.on(/from incomes\s+where user_id = \$1 and deleted_at is null/, () => []);
  await call('GET', '/api/expenses');
  await call('GET', '/api/incomes');
  assert.equal(db.ran(/from expenses\s+where user_id = \$1 and deleted_at is null/).length, 1);
  assert.equal(db.ran(/from incomes\s+where user_id = \$1 and deleted_at is null/).length, 1);
});

test('the list filters by kind and searches descriptions', async () => {
  ledger({
    expenses: [{ ...shoes, ...binned() }, { ...lunch, ...binned() }],
    incomes: [{ ...salary, ...binned() }]
  });

  const incomesOnly = await call('GET', '/api/recycle-bin?kind=income');
  assert.deepEqual(incomesOnly.body.entries.map(e => e.description), ['Salary']);

  const search = await call('GET', '/api/recycle-bin?q=SHO');
  assert.deepEqual(search.body.entries.map(e => e.description), ['Shoes']);
});

test('the account is hidden where this sign-in may not see it', async () => {
  ledger({ flags: { view_permission_user: false }, expenses: [{ ...shoes, ...binned() }] });

  const { body } = await call('GET', '/api/recycle-bin');

  assert.equal(body.entries[0].account, null);
});

// ------------------------------------------------------------- restoring

test('restoring an expense takes its money out again, exactly once', async () => {
  const state = ledger({ expenses: [lunch] });

  await call('DELETE', `/api/expenses/${E1}`);
  assert.equal(state.balances[BANK].balance, 1250);

  const first = await call('POST', `/api/recycle-bin/expense/${E1}/restore`);
  assert.equal(first.status, 200);
  assert.equal(first.body.movedMoney, true);
  assert.equal(state.balances[BANK].balance, 1000);
  assert.equal(state.expenses[0].deleted_at, null);
  assert.equal(state.expenses[0].amount, 250);
  assert.equal(state.expenses[0].description, 'Lunch');

  const second = await call('POST', `/api/recycle-bin/expense/${E1}/restore`);
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already been restored/);
  assert.equal(state.balances[BANK].balance, 1000, 'no second debit');
});

test('a restore that would overdraw the account is refused with the reason, and nothing changes', async () => {
  const state = ledger({ expenses: [{ ...shoes, ...binned() }], balances: {
    [BANK]: { id: BANK, user_id: USER, category: 'HDFC Bank', balance: 400 }
  } });

  const { status, body } = await call('POST', `/api/recycle-bin/expense/${E2}/restore`);

  assert.equal(status, 409);
  assert.match(body.error, /Not enough in HDFC Bank to restore this: it needs ₹900 and HDFC Bank holds ₹400/);
  assert.equal(state.balances[BANK].balance, 400);
  assert.ok(state.expenses[0].deleted_at);
});

test('the overdraw reason leaves the balance out when this sign-in may not see balances', async () => {
  ledger({ flags: { balance_user_access: false }, expenses: [{ ...shoes, ...binned() }], balances: {
    [BANK]: { id: BANK, user_id: USER, category: 'HDFC Bank', balance: 400 }
  } });

  const { body } = await call('POST', `/api/recycle-bin/expense/${E2}/restore`);

  assert.doesNotMatch(body.error, /₹/);
});

test('an expense whose account has since been deleted cannot come back with its payment', async () => {
  ledger({ expenses: [{ ...lunch, source_id: null, ...binned() }] });

  const { status, body } = await call('POST', `/api/recycle-bin/expense/${E1}/restore`);

  assert.equal(status, 409);
  assert.match(body.error, /no longer exists/);
});

test('restoring income puts it back in its account, once', async () => {
  const state = ledger({ incomes: [{ ...salary, ...binned() }] });

  const { status, body } = await call('POST', `/api/recycle-bin/income/${I1}/restore`);

  assert.equal(status, 200);
  assert.equal(body.movedMoney, true);
  assert.equal(state.balances[CASH].balance, 600);
  assert.equal((await call('POST', `/api/recycle-bin/income/${I1}/restore`)).status, 409);
  assert.equal(state.balances[CASH].balance, 600);
});

// ------------------------------------------------------------- splits and repayments

const dinner = {
  id: SPLIT, amount: 1200, description: 'Dinner', date: '2026-10-28', spent_on: '2026-10-28',
  source_id: BANK, source_category: 'HDFC Bank', balance_updated: true,
  split_members: 4, split_share: 300, personal_share: 300
};
const repayment = {
  id: R1, amount: 300, description: 'Asha share', date: '2026-10-29', received_on: '2026-10-29',
  target_id: CASH, target_category: 'Cash', balance_updated: true, split_expense_id: SPLIT
};

test('a removed split keeps its repayments linked, and restoring it brings the split back whole', async () => {
  const state = ledger({ expenses: [dinner], incomes: [repayment] });

  const removed = await call('DELETE', `/api/expenses/${SPLIT}`);
  assert.equal(removed.body.linkedRepayments, 1);
  assert.equal(state.incomes[0].split_expense_id, SPLIT, 'still linked');

  await call('POST', `/api/recycle-bin/expense/${SPLIT}/restore`);
  assert.equal(state.expenses[0].deleted_at, null);
  assert.equal(state.balances[BANK].balance, 1000);
});

test('a repayment of a split that is itself in Recently deleted waits for the split', async () => {
  ledger({ expenses: [{ ...dinner, ...binned() }], incomes: [{ ...repayment, ...binned() }] });

  const { status, body } = await call('POST', `/api/recycle-bin/income/${R1}/restore`);

  assert.equal(status, 409);
  assert.match(body.error, /Restore Dinner first/);
});

test('a repayment cannot come back if the split no longer has that much owing', async () => {
  const extra = { ...repayment, id: '2ccccccc-cccc-4ccc-8ccc-cccccccccc99', amount: 800, description: 'Big share' };
  const state = ledger({ expenses: [dinner], incomes: [extra, { ...repayment, ...binned() }] });

  const { status, body } = await call('POST', `/api/recycle-bin/income/${R1}/restore`);

  assert.equal(status, 409);
  assert.match(body.error, /Only ₹100 is still owed on Dinner/);
  assert.ok(state.incomes[1].deleted_at);
});

test('deleting a split for good turns its repayments into ordinary money in', async () => {
  const state = ledger({ expenses: [{ ...dinner, ...binned() }], incomes: [repayment] });

  await call('DELETE', `/api/recycle-bin/expense/${SPLIT}`);

  assert.equal(state.incomes[0].split_expense_id, null);
  assert.equal(state.incomes.length, 1, 'the repayment itself stays');
});

// ------------------------------------------------------------- deleting for good

test('deleting for good removes only that binned entry, its receipts with it, and audits it', async () => {
  const state = ledger({ expenses: [{ ...shoes, ...binned() }, lunch] });

  const { status } = await call('DELETE', `/api/recycle-bin/expense/${E2}`);

  assert.equal(status, 200);
  assert.deepEqual(state.expenses.map(e => e.id), [E1]);
  assert.equal(state.attachments.length, 0, 'its receipt went with it');
  assert.deepEqual(state.purges, [{ kind: 'expense', reason: 'user', user_id: USER, entry_id: E2, amount_paise: 90000 }]);
  assert.equal(state.balances[BANK].balance, 1000, 'no money moves: it was put back on removal');
});

test('a live entry cannot be deleted for good, and a missing one is not found', async () => {
  ledger({ expenses: [lunch] });

  assert.equal((await call('DELETE', `/api/recycle-bin/expense/${E1}`)).status, 409);
  assert.equal((await call('DELETE', `/api/recycle-bin/expense/${NOBODY}`)).status, 404);
});

test('emptying needs a confirmation and deletes everything binned, nothing live', async () => {
  const state = ledger({
    expenses: [{ ...shoes, ...binned() }, lunch],
    incomes: [{ ...salary, ...binned() }]
  });

  assert.equal((await call('POST', '/api/recycle-bin/empty', { body: {} })).status, 400);
  assert.equal(state.expenses.length, 2);

  const { status, body } = await call('POST', '/api/recycle-bin/empty', { body: { confirm: 'empty' } });

  assert.equal(status, 200);
  assert.deepEqual(body, { purged: 2, expenses: 1, incomes: 1 });
  assert.deepEqual(state.expenses.map(e => e.id), [E1]);
  assert.equal(state.incomes.length, 0);
  assert.deepEqual(state.purges.map(p => p.reason), ['empty', 'empty']);
});

// ------------------------------------------------------------- permissions and ownership

test('without "Remove entries" the list can be seen but nothing restored or deleted', async () => {
  const state = ledger({ flags: { remove_permission_user: false }, expenses: [{ ...shoes, ...binned() }] });

  const list = await call('GET', '/api/recycle-bin');
  assert.equal(list.status, 200);
  assert.equal(list.body.canManage, false);

  assert.equal((await call('POST', `/api/recycle-bin/expense/${E2}/restore`)).status, 403);
  assert.equal((await call('DELETE', `/api/recycle-bin/expense/${E2}`)).status, 403);
  assert.equal((await call('POST', '/api/recycle-bin/empty', { body: { confirm: 'empty' } })).status, 403);
  assert.equal(state.expenses.length, 1);
  assert.ok(state.expenses[0].deleted_at);
});

test("someone else's binned entry is not found, and cannot be restored or deleted", async () => {
  const state = ledger({ expenses: [{ ...shoes, user_id: NOBODY, ...binned() }] });

  assert.equal((await call('GET', '/api/recycle-bin')).body.entries.length, 0);
  assert.equal((await call('POST', `/api/recycle-bin/expense/${E2}/restore`)).status, 404);
  assert.equal((await call('DELETE', `/api/recycle-bin/expense/${E2}`)).status, 404);
  assert.equal(state.expenses.length, 1);
});

test('malformed ids and kinds are refused', async () => {
  ledger();

  assert.equal((await call('POST', '/api/recycle-bin/expense/nope/restore')).status, 400);
  assert.equal((await call('POST', `/api/recycle-bin/transfer/${E1}/restore`)).status, 400);
  assert.equal((await call('DELETE', `/api/recycle-bin/goal/${E1}`)).status, 400);
});

test('every route needs a session', async () => {
  for (const [method, path] of [['GET', '/api/recycle-bin'], ['POST', `/api/recycle-bin/expense/${E1}/restore`],
    ['DELETE', `/api/recycle-bin/expense/${E1}`], ['POST', '/api/recycle-bin/empty']]) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

// ------------------------------------------------------------- retention

test('the clean-up deletes for good only what was binned over 30 days ago, and can run again', async () => {
  const now = new Date('2026-12-15T12:00:00.000Z');
  const old = new Date(now.getTime() - 31 * 86_400_000).toISOString();
  const recent = new Date(now.getTime() - 29 * 86_400_000).toISOString();
  const state = ledger({
    expenses: [{ ...shoes, ...binned({ deleted_at: old }) }, { ...lunch, ...binned({ deleted_at: recent }) }],
    incomes: [{ ...salary, ...binned({ deleted_at: old }) }]
  });

  assert.deepEqual(await purgeExpired({ now }), { expenses: 1, incomes: 1 });
  assert.deepEqual(state.expenses.map(e => e.id), [E1]);
  assert.equal(state.incomes.length, 0);
  assert.deepEqual(state.purges.map(p => p.reason), ['retention', 'retention']);

  // Running again finds nothing new; a live entry is never a candidate.
  assert.deepEqual(await purgeExpired({ now }), { expenses: 0, incomes: 0 });

  const sql = db.ran(/delete from expenses\s+where deleted_at is not null and deleted_at < coalesce/)[0].text;
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /coalesce\(\$1::timestamptz, now\(\)\) - interval '30 days'/, "by the database's clock");
});

test('days left counts down from 30 and stops at zero', () => {
  const deleted = '2026-11-01T00:00:00.000Z';

  assert.equal(RETENTION_DAYS, 30);
  assert.equal(daysLeft(deleted, Date.parse('2026-11-01T00:00:01Z')), 30);
  assert.equal(daysLeft(deleted, Date.parse('2026-11-30T12:00:00Z')), 1);
  assert.equal(daysLeft(deleted, Date.parse('2026-12-02T00:00:00Z')), 0);
});

// ------------------------------------------------------------- budgets

test("a month's budget spending drops when an expense is removed and comes back when it is restored", async () => {
  const BUDGET = '3ddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const state = ledger({ expenses: [lunch, { ...shoes, ...binned() }] });

  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2\s*$/, () => [{ id: BUDGET, total_budget: 10000 }]);
  db.on(/from category_budgets\s+where monthly_budget_id/, () => []);
  db.on(/from budget_alerts\s+where monthly_budget_id/, () => []);
  // Honours the query's own filter: a list that forgot deleted_at would count Shoes.
  db.on(/from expenses\s+where user_id = \$1 and spent_on >= \$2/, ([user, from, to], text) => {
    const rows = state.expenses.filter(e => e.user_id === user && e.date >= from && e.date < to &&
      (!/deleted_at is null/.test(text) || !e.deleted_at));
    const spent = rows.reduce((sum, e) => sum + e.amount, 0);
    return rows.length ? [{ category: null, status: 'done', spent }] : [];
  });

  const spent = async () => (await call('GET', '/api/budgets/2026-10')).body.spent;

  assert.equal(await spent(), 250, 'Shoes, in Recently deleted, does not count');

  await call('DELETE', `/api/expenses/${E1}`);
  assert.equal(await spent(), 0);

  await call('POST', `/api/recycle-bin/expense/${E1}/restore`);
  assert.equal(await spent(), 250, 'counted once again');
});
