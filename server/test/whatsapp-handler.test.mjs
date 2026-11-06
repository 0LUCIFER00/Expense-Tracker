/**
 * The WhatsApp handler's audit fixes, through the real handleMessage.
 *
 * The database is replaced (helpers/fake-db.mjs) and replies are captured from
 * the Graph API call instead of being sent. Run with
 * --experimental-test-module-mocks, which the test:api script passes.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb, settingsRow } from './helpers/fake-db.mjs';

process.env['JWT_SECRET'] = 'test-secret-that-is-at-least-thirty-two-characters-long';
process.env['DATABASE_URL'] = 'postgres://nobody@127.0.0.1:1/never';
// Configured, so replies go through fetch where the test catches them.
process.env['WHATSAPP_TOKEN'] = 'test-token';
process.env['WHATSAPP_PHONE_NUMBER_ID'] = '1234';
process.env['WHATSAPP_APP_SECRET'] = 'test-app-secret';

const db = createFakeDb();

mock.module('../src/db.mjs', {
  namedExports: {
    query: db.query,
    transaction: db.transaction,
    pool: db.pool,
    closePool: db.closePool
  }
});

const replies = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://graph.facebook.com/')) {
    replies.push(JSON.parse(init.body).text.body);
    return new Response('{}', { status: 200 });
  }

  return realFetch(url, init);
};

const { handleMessage } = await import('../src/routes/whatsapp.mjs');
const { extractTextMessages } = await import('../src/whatsapp/client.mjs');
const { resetRateLimits } = await import('../src/rate-limit.mjs');
const { todayInIndia } = await import('../src/http.mjs');

const USER = '22222222-2222-4222-8222-222222222222';
const PHONE = '919800000000';

let nextId = 0;

function message(text, from = PHONE) {
  nextId += 1;
  return { messageId: `wamid.${nextId}`, from, text, sentAt: Math.floor(Date.now() / 1000) };
}

/** A linked user with the given flags, and the plumbing every message needs. */
function linkedUser(flags = {}) {
  db.on(/insert into whatsapp_processed_messages/, () => ({ rows: [], rowCount: 1 }));
  db.on(/delete from whatsapp_processed_messages/, () => []);
  db.on(/select id, name from users where whatsapp_number/, () => [{ id: USER, name: 'Asha K' }]);
  db.on(/from balances\s+where user_id = \$1 and saved = true/, () => [
    { id: 'acc-1', type: 'Bank Account', category: 'HDFC Bank', balance: 5000 }
  ]);
  db.on(/from user_settings where user_id/, () => [settingsRow(flags)]);
  // No budget unless a test sets one up.
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2/, () => []);
}

test.beforeEach(() => {
  db.reset();
  replies.length = 0;
  resetRateLimits();
});

test('undo is refused when removing entries is switched off (H3)', async () => {
  linkedUser({ remove_permission_user: false });

  await handleMessage(message('undo'));

  assert.equal(replies.length, 1);
  assert.match(replies[0], /switched off/);
  assert.equal(db.ran(/delete from expenses/).length, 0);
  assert.equal(db.ran(/delete from incomes/).length, 0);
});

test('undo still works when removing is allowed', async () => {
  linkedUser();
  db.on(/select created_at from (expenses|incomes)/, () => []);
  db.on(/from expenses\s+where user_id = \$1 and source_channel/, () => [{
    id: 'exp-1', amount: 250, description: 'Coffee', spent_on: '2026-11-05',
    source_id: null, source_category: null, balance_updated: false,
    status: 'done', source_channel: 'whatsapp'
  }]);
  db.on(/select count\(\*\)::int as n from incomes/, () => [{ n: 0 }]);
  db.on(/delete from expenses/, () => []);

  await handleMessage(message('undo'));

  assert.equal(db.ran(/delete from expenses/).length, 1);
  assert.match(replies[0], /Removed ₹250/);
});

test('an expense is dated by the Indian calendar, not the database clock (M1)', async () => {
  linkedUser();
  db.on(/insert into expenses/, () => [{ id: 'exp-2', category: 'Food & Drink' }]);

  await handleMessage(message('250 coffee'));

  const insert = db.ran(/insert into expenses/)[0];

  assert.ok(insert, 'the expense was inserted');
  assert.doesNotMatch(insert.text, /current_date/);
  assert.equal(insert.params.at(-1), todayInIndia());
});

test('"today" lists the Indian day', async () => {
  linkedUser();
  db.on(/from expenses\s+where user_id = \$1 and spent_on = \$2/, () => []);

  await handleMessage(message('today'));

  const listed = db.ran(/spent_on = \$2/)[0];

  assert.equal(listed.params[1], todayInIndia());
});

test('an amount over the website ceiling is refused, not saved (M11)', async () => {
  linkedUser();

  await handleMessage(message('150000 laptop hdfc'));
  await handleMessage(message('+150000 bonus hdfc'));

  assert.equal(db.ran(/insert into (expenses|incomes)/).length, 0);
  assert.equal(replies.length, 2);
  assert.match(replies[0], /more than one entry can hold/);
  assert.match(replies[1], /more than one entry can hold/);
});

test('an unconnected number gets a few answers, then silence (L4)', async () => {
  db.on(/insert into whatsapp_processed_messages/, () => ({ rows: [], rowCount: 1 }));
  db.on(/delete from whatsapp_processed_messages/, () => []);
  db.on(/select id, name from users where whatsapp_number/, () => []);

  for (let i = 0; i < 8; i += 1) {
    await handleMessage(message('hello', '919811111111'));
  }

  assert.equal(replies.length, 5);
});

test('link codes cannot be guessed at speed from one number (L4)', async () => {
  db.on(/insert into whatsapp_processed_messages/, () => ({ rows: [], rowCount: 1 }));
  db.on(/delete from whatsapp_processed_messages/, () => []);
  db.on(/select id, name from users where whatsapp_number/, () => []);
  db.on(/delete from whatsapp_link_codes\s+where code/, () => []);

  for (let i = 0; i < 8; i += 1) {
    await handleMessage(message(`link AAAA${i}${i}`, '919822222222'));
  }

  assert.equal(db.ran(/delete from whatsapp_link_codes\s+where code/).length, 5);
});

test('linking claims the code and attaches the number together (L5)', async () => {
  db.on(/insert into whatsapp_processed_messages/, () => ({ rows: [], rowCount: 1 }));
  db.on(/delete from whatsapp_processed_messages/, () => []);
  db.on(/select id, name from users where whatsapp_number/, () => []);
  db.on(/delete from whatsapp_link_codes\s+where code/, () => [{ user_id: USER }]);
  db.on(/update users set whatsapp_number = null/, () => []);
  db.on(/update users set whatsapp_number = \$1 where id = \$2 returning name/, () => [
    { name: 'Asha K' }
  ]);
  db.on(/delete from whatsapp_link_codes where user_id/, () => []);

  await handleMessage(message('link ABC234', '919833333333'));

  assert.match(replies[0], /Connected to Asha K/);
});

test('a retried message is acted on once', async () => {
  linkedUser();
  db.on(/insert into expenses/, () => [{ id: 'exp-3', category: null }]);

  const first = message('80 chai');
  await handleMessage(first);

  // The second delivery finds the id already claimed.
  db.on(/insert into whatsapp_processed_messages/, () => ({ rows: [], rowCount: 0 }));
  await handleMessage(first);

  assert.equal(db.ran(/insert into expenses/).length, 1);
});

test('every text message in a batched delivery is picked up (L6)', () => {
  const body = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id: 'a', from: PHONE, type: 'text', text: { body: '250 coffee' }, timestamp: '1' },
                { id: 'b', from: PHONE, type: 'image', image: {} },
                { id: 'c', from: PHONE, type: 'text', text: { body: 'undo' }, timestamp: '2' }
              ]
            }
          }
        ]
      },
      { changes: [{ value: { messages: [{ id: 'd', from: PHONE, type: 'text', text: { body: 'today' } }] } }] }
    ]
  };

  assert.deepEqual(extractTextMessages(body).map(m => m.messageId), ['a', 'c', 'd']);
  assert.deepEqual(extractTextMessages({}), []);
  assert.deepEqual(extractTextMessages({ entry: 'nonsense' }), []);
});

// ------------------------------------------------------------ budget alerts

/** A Travel budget of ₹3,000 with ₹2,460 spent, whose 80% threshold is new. */
function travelBudgetAt82() {
  db.on(/insert into expenses/, () => [{ id: 'exp-9', category: 'Travel' }]);
  db.on(/from monthly_budgets\s+where user_id = \$1 and month = \$2/, () => [
    { id: 'budget-1', total_budget: null }
  ]);
  db.on(/from category_budgets\s+where monthly_budget_id/, () => [
    { category: 'Travel', amount: 3000 }
  ]);
  db.on(/from expenses\s+where user_id = \$1 and spent_on >= \$2/, () => [
    { category: 'Travel', status: 'done', spent: 2460 }
  ]);
  db.on(/insert into budget_alerts/, () => [
    { scope: 'Travel', threshold: 50 },
    { scope: 'Travel', threshold: 80 }
  ]);
}

test('with budget alerts on, the reply gains one alert line', async () => {
  linkedUser({ whatsapp_budget_alerts: true });
  travelBudgetAt82();

  await handleMessage(message('460 cab'));

  assert.equal(replies.length, 1, 'still one message, not two');
  assert.match(replies[0], /⚠️ Travel is at 82% of its ₹3,000 budget — ₹540 left\./);
});

test('with budget alerts off, the reply is unchanged but the alert is still recorded', async () => {
  linkedUser({ whatsapp_budget_alerts: false });
  travelBudgetAt82();

  await handleMessage(message('460 cab'));

  assert.equal(replies.length, 1);
  assert.doesNotMatch(replies[0], /budget/);
  assert.equal(db.ran(/insert into budget_alerts/).length, 1, 'the Budgets page still lists it');
});
