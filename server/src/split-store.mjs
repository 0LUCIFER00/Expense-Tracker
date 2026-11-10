import { query } from './db.mjs';
import { owedByOthers } from './split.mjs';

const round = value => Math.round(Number(value) * 100) / 100;

/**
 * A split expense as the rest of the app talks about it: who owes what, and
 * how much of that has come back. `received` is summed from the repayments
 * linked to it rather than stored, so it cannot drift from them.
 */
export function toSplit(row) {
  const owed = owedByOthers({ share: row.split_share, members: row.split_members });
  const received = round(row.received ?? 0);

  return {
    id: row.id,
    description: row.description,
    date: row.spent_on,
    status: row.status,
    amount: round(row.amount),
    members: row.split_members,
    share: round(row.split_share),
    personal: round(row.personal_share),
    owed,
    received,
    // Floored: a repayment rounded up by a rupee should read as settled, not
    // as the owner owing someone change.
    remaining: Math.max(0, round(owed - received))
  };
}

const SPLIT_COLUMNS = `
  e.id, e.amount, e.description, e.spent_on, e.status,
  e.split_members, e.split_share, e.personal_share,
  coalesce((select sum(i.amount) from incomes i
             where i.split_expense_id = e.id and i.deleted_at is null), 0) as received
`;

/**
 * Every split expense the account has, newest first, each with the repayments
 * made against it — what a row expands to show when it is clicked.
 */
export async function listSplits(userId) {
  const { rows } = await query(
    `select ${SPLIT_COLUMNS}
       from expenses e
      where e.user_id = $1 and e.split_members is not null and e.deleted_at is null
      order by e.spent_on desc, e.created_at desc`,
    [userId]
  );

  // One query for all of them rather than one per split.
  const { rows: paid } = await query(
    `select id, split_expense_id, amount, description, received_on, target_category
       from incomes
      where user_id = $1 and split_expense_id is not null and deleted_at is null
      order by received_on, created_at`,
    [userId]
  );

  const bySplit = new Map();

  for (const row of paid) {
    if (!bySplit.has(row.split_expense_id)) {
      bySplit.set(row.split_expense_id, []);
    }

    bySplit.get(row.split_expense_id).push({
      id: row.id,
      amount: round(row.amount),
      description: row.description,
      date: row.received_on,
      account: row.target_category
    });
  }

  return rows.map(row => ({ ...toSplit(row), repayments: bySplit.get(row.id) ?? [] }));
}

/** The ones somebody still owes something on — what a repayment can be for. */
export async function listOpenSplits(userId) {
  return (await listSplits(userId)).filter(split => split.remaining > 0);
}

/**
 * Locks one split expense for the length of a transaction and reports it.
 *
 * Locked so that two repayments arriving together cannot both see the same
 * amount outstanding and between them collect more than is owed. The sum is a
 * separate statement because the lock and an aggregate do not share a query.
 *
 * @returns the split, or null when there is no such split on this account.
 */
export async function lockSplit(client, userId, expenseId) {
  const { rows } = await client.query(
    `select id, amount, description, spent_on, status,
            split_members, split_share, personal_share
       from expenses
      where id = $1 and user_id = $2 and split_members is not null and deleted_at is null
      for update`,
    [expenseId, userId]
  );

  if (!rows[0]) {
    return null;
  }

  const { rows: sums } = await client.query(
    `select coalesce(sum(amount), 0) as received from incomes
      where split_expense_id = $1 and deleted_at is null`,
    [expenseId]
  );

  return toSplit({ ...rows[0], received: sums[0].received });
}
