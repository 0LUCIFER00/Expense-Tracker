/**
 * Recently deleted: listing removed entries, restoring them, and deleting
 * them for good.
 *
 * Removing an entry (removeExpense / removeIncome) only marks it deleted and
 * puts its money back, recording in `delete_reversed` whether it did. A
 * restore takes that same step in reverse, once: the row is locked, checked to
 * still be deleted, and only then is the money moved and the mark cleared, in
 * one transaction. A second restore of the same entry, sent twice or at the
 * same moment, finds it no longer deleted and is refused.
 *
 * Deleting for good is a plain DELETE of a row that is already marked, so the
 * database does the rest as it always has: receipts go by cascade (their files
 * queued for removal by trigger), repayments of a split become ordinary money
 * in (on delete set null), and the import log forgets the link. One audit row
 * per entry records that it existed and when it went.
 */
import { query, transaction } from './db.mjs';
import { lockSplit } from './split-store.mjs';

/** Days an entry waits in Recently deleted before it is deleted for good. */
export const RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

const KINDS = {
  expense: { table: 'expenses', date: 'spent_on', account: 'source_category' },
  income: { table: 'incomes', date: 'received_on', account: 'target_category' }
};

export function isKind(value) {
  return Object.hasOwn(KINDS, value);
}

function refuse(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

const toPaise = value => Math.round(Number(value) * 100);

const rupees = paise =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Whole days left before the clean-up takes it, 30 down to 0.
 *
 * The list works this out in SQL, by the database's clock, which is the clock
 * that stamped deleted_at and the one the clean-up uses; this is the same rule
 * for callers that have only the timestamp.
 */
export function daysLeft(deletedAt, now = Date.now()) {
  const expires = new Date(deletedAt).getTime() + RETENTION_DAYS * DAY_MS;

  return Math.min(RETENTION_DAYS, Math.max(0, Math.ceil((expires - now) / DAY_MS)));
}

/** The same, in SQL, by the database's clock. */
const DAYS_LEFT_SQL = (column) =>
  `least(${RETENTION_DAYS}, greatest(0, ceil(extract(epoch from (${column} + interval '${RETENTION_DAYS} days' - now())) / 86400)))::int`;

/**
 * Everything in the account's Recently deleted, newest deletion first.
 *
 * @param filters { kind?: 'expense'|'income', search?: string }
 */
export async function listDeleted(userId, { kind = null, search = '' } = {}) {
  const { rows } = await query(
    `select 'expense' as kind, e.id, e.description, e.amount, e.spent_on as date, e.category,
            e.source_category as account, e.status::text as status,
            e.deleted_at, e.deleted_via, e.delete_reversed,
            ${DAYS_LEFT_SQL('e.deleted_at')} as days_left,
            e.deleted_at + interval '${RETENTION_DAYS} days' as expires_at,
            e.split_members, null::text as repays,
            (select count(*)::int from receipt_attachments a where a.expense_id = e.id) as attachments
       from expenses e
      where e.user_id = $1 and e.deleted_at is not null
        -- Interest undone by reversing a loan repayment is not the person's
        -- to restore here: the repayment's own record keeps it.
        and e.loan_repayment_id is null
     union all
     select 'income', i.id, i.description, i.amount, i.received_on, i.category,
            i.target_category, 'done',
            i.deleted_at, i.deleted_via, i.delete_reversed,
            ${DAYS_LEFT_SQL('i.deleted_at')},
            i.deleted_at + interval '${RETENTION_DAYS} days',
            null, (select x.description from expenses x where x.id = i.split_expense_id),
            0
       from incomes i
      where i.user_id = $1 and i.deleted_at is not null
        and i.loan_repayment_id is null
      order by deleted_at desc`,
    [userId]
  );

  const needle = String(search ?? '').trim().toLowerCase();

  return rows.filter(row =>
    (!kind || row.kind === kind) &&
    (!needle || String(row.description).toLowerCase().includes(needle)));
}

/** The bigger-picture state of a split, for a repayment being restored. */
async function describeSplitExpense(client, userId, expenseId) {
  const { rows } = await client.query(
    'select description, deleted_at from expenses where id = $1 and user_id = $2',
    [expenseId, userId]
  );

  return rows[0] ?? null;
}

/** Locks an account and puts `paise` into it, or takes it out when negative. */
async function moveMoney(client, userId, accountId, paise, { name, canSeeBalances, action }) {
  const { rows } = await client.query(
    'select balance from balances where id = $1 and user_id = $2 for update',
    [accountId, userId]
  );

  if (!rows[0]) {
    throw refuse(`${name ?? 'Its account'} no longer exists, so this cannot be restored with its money.`);
  }

  const balance = toPaise(rows[0].balance);

  if (paise < 0 && balance < -paise) {
    throw refuse(canSeeBalances
      ? `Not enough in ${name} to ${action}: it needs ${rupees(-paise)} and ${name} holds ${rupees(balance)}.`
      : `Not enough in ${name} to ${action}.`);
  }

  const { rows: after } = await client.query(
    `update balances set balance = balance + $1
      where id = $2 and user_id = $3
      returning balance`,
    [paise / 100, accountId, userId]
  );

  return after[0].balance;
}

const CLEAR = 'deleted_at = null, deleted_by = null, deleted_via = null, delete_reversed = null';

/**
 * Brings a removed expense back: its date, amount, category, account and
 * description are untouched by removal, so only the money and the mark need
 * undoing. A pending one comes back pending; its debit still waits for
 * approval.
 *
 * @throws a status-carrying error (404 not found, 409 already restored or not
 *   enough money) with nothing changed
 */
export function restoreExpense(userId, expenseId, { canSeeBalances = false } = {}) {
  return transaction(async client => {
    const { rows } = await client.query(
      `select id, amount, description, spent_on, status, source_id, source_category,
              deleted_at, delete_reversed
         from expenses
        where id = $1 and user_id = $2 and loan_repayment_id is null
        for update`,
      [expenseId, userId]
    );

    const expense = rows[0];

    if (!expense) {
      throw refuse('That entry was not found.', 404);
    }

    if (!expense.deleted_at) {
      throw refuse(`${expense.description} has already been restored.`);
    }

    let balanceAfter = null;

    // Removing it put its debit back; restoring takes it out again, once.
    if (expense.delete_reversed) {
      if (!expense.source_id) {
        throw refuse(`${expense.source_category ?? 'The account it was paid from'} no longer exists, so this cannot be restored with its payment.`);
      }

      balanceAfter = await moveMoney(client, userId, expense.source_id, -toPaise(expense.amount), {
        name: expense.source_category, canSeeBalances, action: 'restore this'
      });
    }

    await client.query(`update expenses set ${CLEAR} where id = $1`, [expense.id]);

    return { ...expense, debited: Boolean(expense.delete_reversed), balanceAfter };
  });
}

/**
 * Brings removed money in back. A repayment comes back against its split,
 * which must still be live and still owed at least this much; once its split
 * has been deleted for good it is ordinary money in and restores as such.
 *
 * The split is locked before the income, the order every repayment path uses,
 * so a restore and a removal of the split cannot each wait on the other.
 */
export function restoreIncome(userId, incomeId, { canSeeBalances = false } = {}) {
  return transaction(async client => {
    const { rows: peek } = await client.query(
      'select split_expense_id from incomes where id = $1 and user_id = $2',
      [incomeId, userId]
    );

    if (!peek[0]) {
      throw refuse('That entry was not found.', 404);
    }

    const splitId = peek[0].split_expense_id;
    let split = null;

    if (splitId) {
      split = await lockSplit(client, userId, splitId);

      if (!split) {
        const parent = await describeSplitExpense(client, userId, splitId);

        throw refuse(parent?.deleted_at
          ? `This repays ${parent.description}, which is in Recently deleted too. Restore ${parent.description} first.`
          : 'The split this repays could not be found.');
      }
    }

    const { rows } = await client.query(
      `select id, amount, description, received_on, target_id, target_category,
              split_expense_id, deleted_at, delete_reversed
         from incomes
        where id = $1 and user_id = $2 and loan_repayment_id is null
        for update`,
      [incomeId, userId]
    );

    const income = rows[0];

    if (!income) {
      throw refuse('That entry was not found.', 404);
    }

    if (!income.deleted_at) {
      throw refuse(`${income.description} has already been restored.`);
    }

    if (income.split_expense_id !== splitId) {
      throw refuse('That entry changed while it was being restored. Try again.');
    }

    const paise = toPaise(income.amount);

    if (split && paise > toPaise(split.remaining)) {
      throw refuse(
        `Only ${rupees(toPaise(split.remaining))} is still owed on ${split.description}, ` +
        `so this ${rupees(paise)} repayment cannot come back.`
      );
    }

    let balanceAfter = null;

    if (income.delete_reversed) {
      if (!income.target_id) {
        throw refuse(`${income.target_category ?? 'The account it went into'} no longer exists, so this cannot be restored with its money.`);
      }

      balanceAfter = await moveMoney(client, userId, income.target_id, paise, {
        name: income.target_category, canSeeBalances, action: 'restore this'
      });
    }

    await client.query(`update incomes set ${CLEAR} where id = $1`, [income.id]);

    return { ...income, credited: Boolean(income.delete_reversed), balanceAfter };
  });
}

/**
 * Deletes marked rows and records each in transaction_purges, in the caller's
 * transaction. Only rows already in Recently deleted can match `where`.
 */
async function purge(client, kind, where, params, reason) {
  const { table, date } = KINDS[kind];
  const { rows } = await client.query(
    `delete from ${table}
      where deleted_at is not null and ${where}
      returning id, user_id, amount, ${date} as entry_date, deleted_at`,
    params
  );

  if (rows.length) {
    await client.query(
      `insert into transaction_purges (user_id, kind, entry_id, amount_paise, entry_date, deleted_at, reason)
       select x.user_id, $1, x.entry_id, x.amount_paise, x.entry_date, x.deleted_at, $2
         from unnest($3::uuid[], $4::uuid[], $5::bigint[], $6::date[], $7::timestamptz[])
              as x(user_id, entry_id, amount_paise, entry_date, deleted_at)
       on conflict (kind, entry_id) do nothing`,
      [
        kind, reason,
        rows.map(r => r.user_id), rows.map(r => r.id), rows.map(r => toPaise(r.amount)),
        rows.map(r => r.entry_date), rows.map(r => r.deleted_at)
      ]
    );
  }

  return rows.length;
}

/**
 * Deletes one entry in Recently deleted for good.
 *
 * @throws 404 when there is no such entry, 409 when it is not deleted (a live
 *   entry is removed first, never deleted outright)
 */
export function purgeEntry(userId, kind, id) {
  return transaction(async client => {
    const count = await purge(client, kind, 'id = $1 and user_id = $2 and loan_repayment_id is null', [id, userId], 'user');

    if (count) {
      return { purged: 1 };
    }

    const { rows } = await client.query(
      `select 1 from ${KINDS[kind].table} where id = $1 and user_id = $2 and loan_repayment_id is null`,
      [id, userId]
    );

    throw rows.length
      ? refuse('Only entries in Recently deleted can be deleted for good.')
      : refuse('That entry was not found.', 404);
  });
}

/** Deletes everything in the account's Recently deleted for good. */
export function emptyBin(userId) {
  return transaction(async client => {
    const expenses = await purge(client, 'expense', 'user_id = $1 and loan_repayment_id is null', [userId], 'empty');
    const incomes = await purge(client, 'income', 'user_id = $1 and loan_repayment_id is null', [userId], 'empty');

    return { purged: expenses + incomes, expenses, incomes };
  });
}

/**
 * The daily clean-up: deletes for good whatever has waited RETENTION_DAYS,
 * across every account, a batch at a time.
 *
 * Safe to run as often as anyone likes: a row restored meanwhile is no longer
 * marked and so never matches, and one being restored right now is locked by
 * that restore and skipped (SKIP LOCKED) for a later run to decide.
 */
export async function purgeExpired({ now = null, limit = 500 } = {}) {
  // By the database's clock, the one that stamped deleted_at; `now` is for tests.
  const cutoff = `coalesce($1::timestamptz, now()) - interval '${RETENTION_DAYS} days'`;
  const totals = { expenses: 0, incomes: 0 };

  for (const kind of ['expense', 'income']) {
    const { table } = KINDS[kind];

    totals[`${table}`] = await transaction(client => purge(
      client,
      kind,
      `deleted_at < ${cutoff} and id in (
         select id from ${table}
          where deleted_at is not null and deleted_at < ${cutoff}
          order by deleted_at
          limit $2
          for update skip locked)`,
      [now, limit],
      'retention'
    ));
  }

  return totals;
}
