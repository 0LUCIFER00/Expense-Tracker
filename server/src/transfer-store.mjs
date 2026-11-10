/**
 * Account transfers in the database, and what is attached to an account.
 *
 * A transfer is one transaction: both account rows are locked (FOR UPDATE, in
 * id order, so two transfers between the same pair in opposite directions
 * cannot deadlock), the source is checked to hold enough, the source is
 * debited, the destination credited, and the transfer row written. Either all
 * of that commits or none of it does.
 *
 * Expenses, income, budgets and recurring schedules are never written here.
 */
import { query, transaction } from './db.mjs';
import { TRANSFER_MAX_PAISE, money } from './transfers.mjs';

const COLUMNS = `
  id, request_id, from_account_id, to_account_id, from_type, from_name,
  to_type, to_name, amount_paise, transfer_date, description, created_at
`;

function refuse(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

/** bigint arrives as text; every amount here fits a safe integer. */
function row(r) {
  return r && { ...r, amount_paise: Number(r.amount_paise) };
}

/** A balance, numeric(14, 2), as whole paise. */
function paiseOf(balance) {
  return Math.round(Number(balance) * 100);
}

/**
 * Moves money between two of the user's own accounts.
 *
 * @returns { transfer, fromBalance, toBalance, duplicate } — duplicate is true
 *   when this request id had already been processed, in which case nothing
 *   moved this time and the earlier transfer is returned.
 */
export function createTransfer(userId, v) {
  return transaction(async client => {
    // Both rows, locked, always in the same (id) order.
    const { rows: accounts } = await client.query(
      `select id, type, category, balance, saved
         from balances
        where user_id = $1 and id = any($2::uuid[])
        order by id
        for update`,
      [userId, [v.fromId, v.toId]]
    );

    const from = accounts.find(a => a.id === v.fromId);
    const to = accounts.find(a => a.id === v.toId);

    if (!from || !to || !from.saved || !to.saved) {
      throw refuse('Choose two of your saved accounts.', 400);
    }

    // Checked after the locks: a second copy of the same request waits for
    // the first to commit, then finds it here instead of moving money twice.
    if (v.requestId) {
      const { rows: [existing] } = await client.query(
        `select ${COLUMNS} from account_transfers where user_id = $1 and request_id = $2`,
        [userId, v.requestId]
      );

      if (existing) {
        return {
          transfer: row(existing),
          fromBalance: Number(from.balance),
          toBalance: Number(to.balance),
          duplicate: true
        };
      }
    }

    const fromPaise = paiseOf(from.balance);
    const toPaise = paiseOf(to.balance);

    if (fromPaise < v.amountPaise) {
      throw refuse(`Not enough in ${from.category}: it holds ${money(fromPaise)}.`);
    }

    if (toPaise + v.amountPaise > TRANSFER_MAX_PAISE) {
      throw refuse(`That would take ${to.category} past the most an account can hold.`, 400);
    }

    const { rows: [debited] } = await client.query(
      `update balances set balance = balance - ($1::bigint::numeric / 100)
        where id = $2 and user_id = $3
        returning balance`,
      [v.amountPaise, from.id, userId]
    );

    const { rows: [credited] } = await client.query(
      `update balances set balance = balance + ($1::bigint::numeric / 100)
        where id = $2 and user_id = $3
        returning balance`,
      [v.amountPaise, to.id, userId]
    );

    const { rows: [transfer] } = await client.query(
      `insert into account_transfers (
         user_id, request_id, from_account_id, to_account_id,
         from_type, from_name, to_type, to_name,
         amount_paise, transfer_date, description
       )
       values ($1, coalesce($2::uuid, gen_random_uuid()), $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning ${COLUMNS}`,
      [
        userId, v.requestId, from.id, to.id,
        from.type, from.category, to.type, to.category,
        v.amountPaise, v.date, v.description
      ]
    );

    return {
      transfer: row(transfer),
      fromBalance: Number(debited.balance),
      toBalance: Number(credited.balance),
      duplicate: false
    };
  });
}

/**
 * The user's transfers, newest first, optionally narrowed to one account
 * (either side) and a date range.
 */
export async function listTransfers(userId, { accountId = null, from = null, to = null, limit = 200 } = {}) {
  const { rows } = await query(
    `select ${COLUMNS} from account_transfers
      where user_id = $1
        and ($2::uuid is null or from_account_id = $2 or to_account_id = $2)
        and ($3::date is null or transfer_date >= $3)
        and ($4::date is null or transfer_date <= $4)
      order by transfer_date desc, created_at desc
      limit $5`,
    [userId, accountId, from, to, limit]
  );

  return rows.map(row);
}

/**
 * What would be lost or orphaned by deleting an account: its balance and
 * every record that points at it. Null when it is not this user's.
 */
export async function accountUsage(userId, accountId) {
  const { rows: [usage] } = await query(
    `select b.category, b.balance,
            (select count(*)::int from expenses e where e.source_id = b.id) as expenses,
            (select count(*)::int from incomes i where i.target_id = b.id) as incomes,
            (select count(*)::int from account_transfers t
              where t.from_account_id = b.id or t.to_account_id = b.id) as transfers,
            (select count(*)::int from recurring_schedules r
              where r.account_id = b.id and r.status <> 'completed') as schedules,
            (select count(*)::int from loans l where l.account_id = b.id)
              + (select count(*)::int from loan_repayments p where p.account_id = b.id) as loans
       from balances b
      where b.id = $1 and b.user_id = $2`,
    [accountId, userId]
  );

  if (!usage) {
    return null;
  }

  const balancePaise = paiseOf(usage.balance);
  const reasons = [];

  if (balancePaise !== 0) {
    reasons.push(`It still holds ${money(balancePaise)}. Transfer it to another account first.`);
  }

  const history = [
    [usage.expenses, 'expense', 'expenses'],
    [usage.incomes, 'income entry', 'income entries'],
    [usage.transfers, 'transfer', 'transfers'],
    [usage.loans, 'lending or borrowing record', 'lending and borrowing records']
  ].filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

  if (history.length) {
    reasons.push(`It has history (${history.join(', ')}). Deleting it would leave those records pointing nowhere.`);
  }

  if (usage.schedules > 0) {
    reasons.push(
      `${usage.schedules} recurring ${usage.schedules === 1 ? 'schedule uses' : 'schedules use'} it. ` +
      'Change or delete them on the Recurring page first.'
    );
  }

  return {
    name: usage.category,
    balance: Number(usage.balance),
    expenses: usage.expenses,
    incomes: usage.incomes,
    transfers: usage.transfers,
    schedules: usage.schedules,
    loans: usage.loans ?? 0,
    deletable: reasons.length === 0,
    reasons
  };
}
