/**
 * Lending and borrowing through the real routes, against a stand-in database
 * that keeps state: permissions, validation, ownership, the account moves,
 * interest filed as income or an expense (and principal never), partial
 * repayments into other accounts, duplicate submissions, reversals,
 * cancellation, edits, and that interest entries cannot be removed from the
 * Transactions page on their own.
 *
 * Locking and real concurrency are exercised against Postgres by the
 * end-to-end run in LENDING_BORROWING_REPORT.md. Run with
 * --experimental-test-module-mocks.
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

const USER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const BANK = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASH = '0ccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THEIRS = '0eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNSAVED = '0fffffff-ffff-4fff-8fff-ffffffffffff';
const today = todayInIndia();

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const paise = rupees => Math.round(Number(rupees) * 100);

/** The tables, as plain rows. Balances in paise to keep sums exact. */
let state;

function freshState() {
  state = {
    balances: {
      [BANK]: { id: BANK, user_id: USER, type: 'Bank Account', category: 'HDFC Bank', balance: 1_000_000, saved: true },
      [CASH]: { id: CASH, user_id: USER, type: 'Hand Cash', category: 'Cash', balance: 50_000, saved: true },
      [THEIRS]: { id: THEIRS, user_id: OTHER, type: 'Bank Account', category: 'Their bank', balance: 9_999_999, saved: true },
      [UNSAVED]: { id: UNSAVED, user_id: USER, type: 'Wallet', category: 'Draft', balance: 0, saved: false }
    },
    loans: [],
    repayments: [],
    incomes: [],
    expenses: []
  };
}

const balanceOut = b => ({ ...b, balance: b.balance / 100 });
const clone = r => r && { ...r };

function plumbing(flags = {}) {
  db.reset();

  db.on(/from users u\s+left join user_settings/, () => [{ session_version: 0, has_settings: USER, ...settingsRow(flags) }]);

  // ---- accounts
  db.on(/from balances\s+where user_id = \$1 and id = any\(\$2::uuid\[\]\)\s+order by id\s+for update/, ([user, ids]) =>
    ids.map(id => state.balances[id]).filter(b => b && b.user_id === user).sort((a, b) => a.id.localeCompare(b.id)).map(balanceOut));
  db.on(/update balances set balance = balance \+ \(\$1::bigint::numeric \/ 100\)\s+where id = \$2 and user_id = \$3/, ([signed, id, user]) => {
    const b = state.balances[id];
    assert.equal(b.user_id, user);
    b.balance += signed;
    assert.ok(b.balance >= 0, 'balance went below zero');
    return [{ balance: b.balance / 100 }];
  });
  // insertIncome / insertExpense: their own lock and move.
  db.on(/from balances\s+where id = \$1 and user_id = \$2 and saved = true\s+for update/, ([id, user]) => {
    const b = state.balances[id];
    return b && b.user_id === user && b.saved ? [balanceOut(b)] : [];
  });
  db.on(/update balances set balance = balance \+ \$1\s+where id = \$2 and user_id = \$3\s+returning balance/, ([amount, id]) => {
    state.balances[id].balance += paise(amount);
    return [{ balance: state.balances[id].balance / 100 }];
  });
  db.on(/update balances set balance = balance - \$1 where id = \$2/, ([amount, id]) => {
    state.balances[id].balance -= paise(amount);
    assert.ok(state.balances[id].balance >= 0, 'balance went below zero');
    return [];
  });

  // ---- loans
  db.on(/from loans where user_id = \$1 and request_id = \$2/, ([user, req]) =>
    state.loans.filter(l => l.user_id === user && l.request_id === req).map(clone));
  db.on(/insert into loans/, p => {
    const loan = {
      id: uuid(), user_id: p[0], request_id: p[1] ?? uuid(), direction: p[2], person_name: p[3], contact: p[4],
      principal_paise: String(p[5]), start_date: p[6], due_date: p[7], account_id: p[8], account_type: p[9],
      account_name: p[10], interest_type: p[11], interest_rate_bp: p[12], interest_period: p[13], notes: p[14],
      status: 'active', cancelled_at: null, cancel_reason: null, created_at: `t${seq}`, updated_at: `t${seq}`
    };
    state.loans.push(loan);
    return [clone(loan)];
  });
  db.on(/from loans where id = \$1 and user_id = \$2/, ([id, user]) =>
    state.loans.filter(l => l.id === id && l.user_id === user).map(clone));
  db.on(/from loans where user_id = \$1 order by/, ([user]) => state.loans.filter(l => l.user_id === user).map(clone));
  db.on(/update loans\s+set person_name = \$3/, p => {
    const loan = state.loans.find(l => l.id === p[0] && l.user_id === p[1]);
    Object.assign(loan, {
      person_name: p[2], contact: p[3], principal_paise: String(p[4]), start_date: p[5], due_date: p[6],
      interest_type: p[7], interest_rate_bp: p[8], interest_period: p[9], notes: p[10]
    });
    return [clone(loan)];
  });
  db.on(/update loans set status = 'cancelled'/, ([id, user, reason]) => {
    const loan = state.loans.find(l => l.id === id && l.user_id === user);
    Object.assign(loan, { status: 'cancelled', cancelled_at: 'now', cancel_reason: reason });
    return [clone(loan)];
  });

  // ---- repayments
  const active = loanId => state.repayments.filter(r => r.loan_id === loanId && !r.reversed_at);
  db.on(/from loan_repayments\s+where loan_id = \$1 and reversed_at is null/, ([loanId]) => active(loanId).map(clone));
  db.on(/from loan_repayments where user_id = \$1 and request_id = \$2/, ([user, req]) =>
    state.repayments.filter(r => r.user_id === user && r.request_id === req).map(clone));
  db.on(/from loan_repayments where user_id = \$1 order by/, ([user]) => state.repayments.filter(r => r.user_id === user).map(clone));
  db.on(/from loan_repayments where id = \$1 and loan_id = \$2 for update/, ([id, loanId]) =>
    state.repayments.filter(r => r.id === id && r.loan_id === loanId).map(clone));
  db.on(/insert into loan_repayments/, p => {
    const r = {
      id: uuid(), loan_id: p[0], user_id: p[1], request_id: p[2] ?? uuid(), amount_paise: String(p[3]),
      principal_paise: String(p[4]), interest_paise: String(p[5]), paid_on: p[6], account_id: p[7],
      account_type: p[8], account_name: p[9], note: p[10], reversed_at: null, reversed_reason: null, created_at: `t${seq}`
    };
    assert.equal(Number(r.principal_paise) + Number(r.interest_paise), Number(r.amount_paise));
    state.repayments.push(r);
    return [clone(r)];
  });
  db.on(/update loan_repayments set reversed_at = now\(\), reversed_reason = \$2/, ([id, reason]) => {
    const r = state.repayments.find(x => x.id === id);
    Object.assign(r, { reversed_at: 'now', reversed_reason: reason });
    return [clone(r)];
  });

  // ---- interest entries
  db.on(/insert into incomes/, p => {
    const row = { id: uuid(), user_id: p[0], amount: Number(p[1]), description: p[2], received_on: p[3], category: p[4],
      target_id: p[5], balance_updated: p[8], loan_repayment_id: p[12], deleted_at: null };
    state.incomes.push(row);
    return [clone(row)];
  });
  db.on(/insert into expenses/, p => {
    const row = { id: uuid(), user_id: p[0], amount: Number(p[1]), description: p[2], spent_on: p[3], category: p[4],
      source_id: p[5], balance_updated: p[10], status: p[11], loan_repayment_id: p[17], deleted_at: null };
    state.expenses.push(row);
    return [{ id: row.id, spent_on: row.spent_on, status: row.status }];
  });
  db.on(/update (incomes|expenses)\s+set deleted_at = now\(\), deleted_by = \$2, deleted_via = \$3, delete_reversed = true\s+where loan_repayment_id = \$1/, ([rid, user, via], text) => {
    const rows = /update incomes/.test(text) ? state.incomes : state.expenses;
    for (const row of rows.filter(r => r.loan_repayment_id === rid && r.user_id === user && !r.deleted_at)) {
      Object.assign(row, { deleted_at: 'now', deleted_via: via, delete_reversed: true });
    }
    return [];
  });
}

function cookie(loginType = 'user') {
  return `et_session=${jwt.sign({ sub: USER, loginType, ver: 0 }, SECRET, { algorithm: 'HS256' })}`;
}

async function call(method, path, body, { loginType = 'user' } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookie(loginType) },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: res.status, body: await res.json() };
}

const bal = id => state.balances[id].balance / 100;
const lend = extra => ({ direction: 'lent', personName: 'Asha', amount: 2000, accountId: BANK, date: today, requestId: uuid(), ...extra });
const borrow = extra => lend({ direction: 'borrowed', personName: 'Ravi', ...extra });
const repay = extra => ({ amount: 500, accountId: BANK, date: today, requestId: uuid(), ...extra });
const live = rows => rows.filter(r => !r.deleted_at);

/** A record made through the API, with its id. */
async function made(body) {
  const res = await call('POST', '/api/loans', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.loan;
}

/** A loan as if it had been made `days` ago, for interest. */
function backdate(loanId, date) {
  state.loans.find(l => l.id === loanId).start_date = date;
}

const daysAgo = n => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

test.beforeEach(() => {
  freshState();
  plumbing();
});

test('lending needs a sign-in, seeing it needs balances, recording it needs balance changes', async () => {
  assert.equal((await fetch(`${base}/api/loans`)).status, 401);

  plumbing({ balance_user_access: false });
  assert.equal((await call('GET', '/api/loans')).status, 403);

  plumbing({ expense_user_access: false });
  assert.equal((await call('POST', '/api/loans', lend())).status, 403);
  assert.equal(db.ran(/balances|loans/).filter(c => !/user_settings/.test(c.text)).length, 0);

  plumbing({ expense_user_access: false, balance_user_access: false });
  assert.equal((await call('POST', '/api/loans', lend(), { loginType: 'admin' })).status, 201, 'full access may');
});

test('money lent leaves the account, is recorded with it, and is neither an expense nor income', async () => {
  const res = await call('POST', '/api/loans', lend({ amount: '2500.50', contact: '98450 00000', notes: 'For rent' }));

  assert.equal(res.status, 201);
  assert.equal(bal(BANK), 7_499.5);
  assert.equal(res.body.balanceAfter, 7_499.5);
  assert.deepEqual(
    [res.body.loan.accountName, res.body.loan.principal, res.body.loan.outstanding, res.body.loan.status, res.body.loan.contact],
    ['HDFC Bank', 2500.5, 2500.5, 'active', '98450 00000']
  );
  assert.equal(state.expenses.length + state.incomes.length, 0, 'no expense or income for principal');
});

test('money borrowed arrives in the account, and is not income', async () => {
  const res = await call('POST', '/api/loans', borrow({ amount: 3000, accountId: CASH }));

  assert.equal(res.status, 201);
  assert.equal(bal(CASH), 3_500);
  assert.equal(res.body.loan.direction, 'borrowed');
  assert.equal(state.incomes.length, 0);
});

test('lending more than the account holds is refused, and nothing moves', async () => {
  const res = await call('POST', '/api/loans', lend({ amount: '500.01', accountId: CASH }));

  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough in Cash: it holds ₹500/);
  assert.equal(bal(CASH), 500);
  assert.equal(state.loans.length, 0);
});

test('the whole balance can be lent, leaving exactly zero', async () => {
  assert.equal((await call('POST', '/api/loans', lend({ amount: 500, accountId: CASH }))).status, 201);
  assert.equal(bal(CASH), 0);
});

test("another person's account, an unsaved one or a made-up one cannot be used", async () => {
  for (const accountId of [THEIRS, UNSAVED, '01234567-89ab-4cde-8f01-23456789abcd']) {
    const res = await call('POST', '/api/loans', lend({ accountId }));
    assert.equal(res.status, 400, accountId);
  }
  assert.equal(state.balances[THEIRS].balance, 9_999_999);
  assert.equal(state.loans.length, 0);
});

test('bad input is refused before the database; an earlier date needs "Change transaction dates"', async () => {
  for (const body of [lend({ amount: 0 }), lend({ personName: '' }), lend({ date: '2999-01-01' }),
    lend({ interest: { type: 'simple', rate: 0, period: 'year' } }), lend({ direction: 'maybe' })]) {
    assert.equal((await call('POST', '/api/loans', body)).status, 400, JSON.stringify(body));
  }

  plumbing({ update_permission_user: false });
  assert.equal((await call('POST', '/api/loans', lend({ date: daysAgo(3) }))).status, 403);
  assert.equal(db.ran(/update balances/).length, 0);
});

test('the same submission twice is one record: the second moves nothing', async () => {
  const body = lend();
  const first = await call('POST', '/api/loans', body);
  const again = await call('POST', '/api/loans', body);

  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(state.loans.length, 1);
  assert.equal(bal(BANK), 8_000);
});

test('partial repayments of money lent go into whichever account they arrive in', async () => {
  const loan = await made(lend({ amount: 2000 }));

  const one = await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 500, accountId: CASH, note: 'first part' }));
  assert.equal(one.status, 201);
  assert.equal(one.body.repayment.accountName, 'Cash');
  assert.equal(one.body.loan.status, 'partial');
  assert.equal(one.body.loan.outstanding, 1500);

  const two = await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 1500, accountId: BANK }));
  assert.equal(two.body.loan.status, 'completed');
  assert.equal(two.body.loan.outstanding, 0);

  assert.deepEqual([bal(BANK), bal(CASH)], [9_500, 1_000]);
  assert.equal(state.incomes.length, 0, 'principal coming back is not income');
  assert.equal(state.loans[0].account_id, BANK, 'the original account stays recorded');
});

test('interest received is income, filed once; principal is not', async () => {
  const loan = await made(lend({ amount: 10_000, interest: { type: 'simple', rate: 12, period: 'year' } }));
  backdate(loan.id, daysAgo(73)); // ₹240 of interest by today

  const res = await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 5240 }));

  assert.equal(res.status, 201);
  assert.deepEqual([res.body.repayment.interest, res.body.repayment.principal], [240, 5000]);
  assert.equal(bal(BANK), 10_000 - 10_000 + 5_240);
  assert.equal(state.incomes.length, 1);
  assert.deepEqual(
    [state.incomes[0].amount, state.incomes[0].category, state.incomes[0].description, state.incomes[0].loan_repayment_id],
    [240, 'Interest', 'Interest from Asha', res.body.repayment.id]
  );
  assert.equal(res.body.loan.interestPaid, 240);
  assert.equal(res.body.loan.principalOutstanding, 5000);
});

test('interest paid on a debt is an expense; the account pays the whole repayment', async () => {
  const loan = await made(borrow({ amount: 10_000, interest: { type: 'simple', rate: 1, period: 'month' } }));
  backdate(loan.id, daysAgo(30)); // 10,000 × 1% × 12 × 30/365 = ₹98.63
  assert.equal(bal(BANK), 20_000);

  const res = await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 1098.63 }));

  assert.equal(res.status, 201);
  assert.deepEqual([res.body.repayment.interest, res.body.repayment.principal], [98.63, 1000]);
  assert.equal(bal(BANK), 20_000 - 1098.63);
  assert.equal(state.expenses.length, 1);
  assert.deepEqual(
    [state.expenses[0].amount, state.expenses[0].category, state.expenses[0].description, state.expenses[0].status],
    [98.63, 'Other', 'Interest paid to Ravi', 'done']
  );
});

test('paying back a debt needs the account to hold the whole amount', async () => {
  const loan = await made(borrow({ amount: 300, accountId: CASH }));
  state.balances[CASH].balance = 10_000; // ₹100 left, after spending

  const res = await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 150, accountId: CASH }));

  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough in Cash/);
  assert.equal(bal(CASH), 100);
  assert.equal(state.repayments.length, 0);
});

test('more than is owed, an earlier date than the last repayment, or a cancelled record: refused', async () => {
  const loan = await made(lend({ amount: 1000, date: daysAgo(10) }));

  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 1000.01 }))).status, 409);
  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 100, date: daysAgo(11) }))).status, 400);
  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 100, date: daysAgo(2) }))).status, 201);
  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 100, date: daysAgo(5) }))).status, 400);

  await call('POST', `/api/loans/${loan.id}/cancel`, { confirm: true });
  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 100 }))).status, 409);
});

test('a repeated repayment submission is counted once', async () => {
  const loan = await made(lend({ amount: 1000 }));
  const body = repay({ amount: 400 });

  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, body)).status, 201);
  const again = await call('POST', `/api/loans/${loan.id}/repayments`, body);

  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(state.repayments.length, 1);
  assert.equal(bal(BANK), 9_400);
});

test("another person's record cannot be repaid, changed, reversed or cancelled", async () => {
  const loan = await made(lend());
  state.loans[0].user_id = OTHER;

  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments`, repay())).status, 404);
  assert.equal((await call('PUT', `/api/loans/${loan.id}`, lend())).status, 404);
  assert.equal((await call('POST', `/api/loans/${loan.id}/cancel`, { confirm: true })).status, 404);
  assert.equal((await call('GET', `/api/loans/${loan.id}/quote`)).status, 404);
  assert.equal((await call('GET', '/api/loans')).body.loans.length, 0);
  assert.equal((await call('POST', '/api/loans/not-an-id/repayments', repay())).status, 400);
});

test('reversing the latest repayment puts the money back and takes its interest out of income', async () => {
  const loan = await made(lend({ amount: 10_000, interest: { type: 'simple', rate: 12, period: 'year' } }));
  backdate(loan.id, daysAgo(73));
  const first = (await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 1000 }))).body.repayment;
  const second = (await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 1000, accountId: CASH }))).body.repayment;

  const early = await call('POST', `/api/loans/${loan.id}/repayments/${first.id}/reverse`);
  assert.equal(early.status, 409, 'only the latest');
  assert.match(early.body.error, /later repayments first/);

  const res = await call('POST', `/api/loans/${loan.id}/repayments/${second.id}/reverse`);
  assert.equal(res.status, 200);
  assert.equal(res.body.repayment.reversed, true);
  assert.equal(bal(CASH), 500);
  assert.equal((await call('POST', `/api/loans/${loan.id}/repayments/${second.id}/reverse`)).status, 409);

  await call('POST', `/api/loans/${loan.id}/repayments/${first.id}/reverse`);
  assert.equal(bal(BANK), 0);
  assert.equal(live(state.incomes).length, 0, 'the interest income is out of the totals');
  assert.equal(state.repayments.length, 2, 'both repayments are kept, marked');
  assert.ok(state.repayments.every(r => r.reversed_reason === 'reversed'));
});

test('a reversal is refused when the money has since been spent from the account', async () => {
  const loan = await made(lend({ amount: 1000 }));
  const r = (await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 400, accountId: CASH }))).body.repayment;
  state.balances[CASH].balance = 10_000; // ₹100 left

  const res = await call('POST', `/api/loans/${loan.id}/repayments/${r.id}/reverse`);
  assert.equal(res.status, 409);
  assert.equal(bal(CASH), 100);
  assert.equal(state.repayments[0].reversed_at, null);
});

test('cancelling needs confirming, reverses every repayment and the principal, and keeps the history', async () => {
  const loan = await made(borrow({ amount: 10_000, interest: { type: 'simple', rate: 12, period: 'year' } }));
  backdate(loan.id, daysAgo(73));
  await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 1240 }));
  await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 200, accountId: CASH }));
  assert.deepEqual([bal(BANK), bal(CASH)], [18_760, 300]);

  assert.equal((await call('POST', `/api/loans/${loan.id}/cancel`, {})).status, 400, 'not without confirming');

  const res = await call('POST', `/api/loans/${loan.id}/cancel`, { confirm: true, reason: 'Entered twice' });
  assert.equal(res.status, 200);
  assert.equal(res.body.reversedRepayments, 2);
  assert.equal(res.body.loan.status, 'cancelled');
  assert.deepEqual([bal(BANK), bal(CASH)], [10_000, 500], 'every account back where it started');
  assert.equal(live(state.expenses).length, 0, 'the interest expense is out of the totals');
  assert.ok(state.repayments.every(r => r.reversed_reason === 'cancelled'));
  assert.equal(state.loans[0].cancel_reason, 'Entered twice');
  assert.equal((await call('POST', `/api/loans/${loan.id}/cancel`, { confirm: true })).status, 409);
});

test('cancelling money borrowed is refused as a whole when the account no longer holds it', async () => {
  const loan = await made(borrow({ amount: 300, accountId: CASH }));
  state.balances[CASH].balance = 10_000;

  const res = await call('POST', `/api/loans/${loan.id}/cancel`, { confirm: true });
  assert.equal(res.status, 409);
  assert.equal(state.loans[0].status, 'active');
});

test('edits: details any time; the amount only before repayments, moving the difference; never the account', async () => {
  const loan = await made(lend({ amount: 2000 }));
  const edit = extra => ({ personName: 'Asha K', amount: 2000, date: loan.date, accountId: BANK, ...extra });

  const more = await call('PUT', `/api/loans/${loan.id}`, edit({ amount: 2500, dueDate: today, notes: 'More' }));
  assert.equal(more.status, 200);
  assert.equal(bal(BANK), 7_500, 'lending ₹500 more takes ₹500 more out');
  assert.equal(more.body.loan.personName, 'Asha K');

  assert.equal((await call('PUT', `/api/loans/${loan.id}`, edit({ amount: 2500, accountId: CASH }))).status, 400);

  await call('POST', `/api/loans/${loan.id}/repayments`, repay({ amount: 100 }));
  const fixed = await call('PUT', `/api/loans/${loan.id}`, edit({ amount: 3000 }));
  assert.equal(fixed.status, 409);
  assert.match(fixed.body.error, /fixed once a repayment is recorded/);

  const renamed = await call('PUT', `/api/loans/${loan.id}`, edit({ amount: 2500, personName: 'Asha Kumar', contact: 'asha@example.test' }));
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.loan.contact, 'asha@example.test');
  assert.equal(bal(BANK), 7_600);
});

test('the page: records with their figures, overdue status, repayment history and totals', async () => {
  const lent = await made(lend({ amount: 10_000, interest: { type: 'simple', rate: 12, period: 'year' } }));
  backdate(lent.id, daysAgo(73));
  state.loans[0].due_date = daysAgo(1);
  await call('POST', `/api/loans/${lent.id}/repayments`, repay({ amount: 1240 }));
  const owed = await made(borrow({ amount: 3000 }));
  const gone = await made(lend({ amount: 100 }));
  await call('POST', `/api/loans/${gone.id}/cancel`, { confirm: true });

  const { status, body } = await call('GET', '/api/loans');

  assert.equal(status, 200);
  assert.equal(body.today, today);
  const byId = Object.fromEntries(body.loans.map(l => [l.id, l]));
  assert.equal(byId[lent.id].status, 'overdue');
  assert.equal(byId[lent.id].interest.label, '12% a year, simple');
  assert.equal(byId[owed.id].status, 'active');
  assert.equal(byId[gone.id].status, 'cancelled');
  assert.equal(body.repayments.length, 1);
  assert.equal(body.repayments[0].personName, 'Asha');
  assert.deepEqual(
    [body.summary.totalLent, body.summary.totalBorrowed, body.summary.toReceive, body.summary.toPay, body.summary.interestReceived, body.summary.overdue],
    [10_000, 3_000, 9_000, 3_000, 240, 1],
    'the cancelled record counts nowhere'
  );
});

test('the repayment form is told what is owed on a date', async () => {
  const loan = await made(lend({ amount: 10_000, interest: { type: 'simple', rate: 12, period: 'year' } }));
  backdate(loan.id, daysAgo(73));

  const { body } = await call('GET', `/api/loans/${loan.id}/quote?date=${today}`);
  assert.deepEqual([body.principalDue, body.interestDue, body.totalDue], [10_000, 240, 10_240]);
  assert.equal((await call('GET', `/api/loans/${loan.id}/quote?date=2999-01-01`)).status, 400);
});

test('interest filed by a repayment cannot be removed from Transactions on its own', async () => {
  db.on(/from incomes\s+where id = \$1 and user_id = \$2 and deleted_at is null\s+for update/, () => [
    { id: 'i1', amount: 240, target_id: BANK, balance_updated: true, loan_repayment_id: 'r1' }
  ]);
  db.on(/from expenses\s+where id = \$1 and user_id = \$2 and deleted_at is null\s+for update/, () => [
    { id: 'e1', amount: 98.63, source_id: BANK, balance_updated: true, loan_repayment_id: 'r2' }
  ]);

  for (const path of ['/api/incomes/0aaaaaaa-0000-4000-8000-000000000001', '/api/expenses/0aaaaaaa-0000-4000-8000-000000000002']) {
    const res = await call('DELETE', path);
    assert.equal(res.status, 409, path);
    assert.match(res.body.error, /Reverse that repayment there instead/);
  }
  assert.equal(db.ran(/update balances|set deleted_at = now\(\)/).length, 0);
});
