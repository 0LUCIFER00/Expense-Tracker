import { transaction } from './db.mjs';

const COLUMNS = `
  id, amount, description, spent_on, source_id, source_category,
  balance_updated, status, source_channel
`;

/**
 * Records an expense inside the caller's transaction, debiting the account
 * when it is settled and asked to.
 *
 * The website's Add Expense and the recurring runner both go through here, so
 * the sufficient-funds rule and what is stored cannot drift apart. Throws an
 * error with `status` (400 bad account, 409 insufficient balance) for a refusal;
 * nothing has been written when it does.
 *
 * @param entry { amount, description, date, category, sourceId, updateBalance,
 *   canBackdate, status, members, split, remarks?, recurringRunId? }
 * @param returning the columns to hand back
 */
export async function insertExpense(client, userId, entry, returning = 'id, spent_on, status') {
  const { amount, sourceId, updateBalance, status } = entry;
  let source = null;

  if (sourceId) {
    // Lock the row so two concurrent expenses cannot both pass the
    // sufficient-funds check against the same balance.
    const { rows } = await client.query(
      `select id, type, category, balance
         from balances
        where id = $1 and user_id = $2 and saved = true
        for update`,
      [sourceId, userId]
    );

    source = rows[0] ?? null;

    if (!source) {
      throw Object.assign(new Error('Please select a valid balance account.'), {
        status: 400
      });
    }
  }

  // Only a settled entry moves money; a pending one waits for approval.
  const debit = updateBalance && status === 'done';

  if (debit) {
    if (Number(source.balance) < amount) {
      throw Object.assign(new Error('Insufficient balance.'), { status: 409 });
    }

    await client.query(
      'update balances set balance = balance - $1 where id = $2',
      [amount, source.id]
    );
  }

  const remarks = entry.remarks ?? (status === 'pending'
    ? (updateBalance ? 'Wait for admin to add and update balance' : 'Wait for admin to add')
    : (debit ? 'Added and balance updated' : 'Added in list'));

  const { rows } = await client.query(
    `insert into expenses (
       user_id, amount, description, spent_on, category,
       source_id, source_type, source_category,
       expense_access, update_permission, balance_updated, status, remarks,
       split_members, split_share, personal_share, recurring_run_id
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning ${returning}`,
    [
      userId, amount, entry.description, entry.date, entry.category,
      source?.id ?? null, source?.type ?? null, source?.category ?? null,
      updateBalance, entry.canBackdate, debit, status, remarks,
      entry.members ?? null, entry.split?.share ?? null, entry.split?.personal ?? null,
      entry.recurringRunId ?? null
    ]
  );

  return { ...rows[0], debited: debit };
}

/**
 * Removes an expense and puts back any money it debited.
 *
 * Both the website's delete button and WhatsApp's "undo" go through here, so
 * the two cannot drift apart — deleting an entry that moved money must refund
 * it either way, otherwise the balances stop matching the expense list.
 *
 * Pass `expenseId` to remove a specific entry, or `lastFromChannel` to remove
 * the most recent one that arrived over that channel.
 *
 * @returns the removed row plus `refunded` and `detachedRepayments`, or null
 *   when there was nothing to remove.
 */
export function removeExpense(userId, { expenseId = null, lastFromChannel = null } = {}) {
  return transaction(async client => {
    const { rows } = expenseId
      ? await client.query(
          `select ${COLUMNS} from expenses
            where id = $1 and user_id = $2
            for update`,
          [expenseId, userId]
        )
      : await client.query(
          `select ${COLUMNS} from expenses
            where user_id = $1 and source_channel = $2
            order by created_at desc
            limit 1
            for update`,
          [userId, lastFromChannel]
        );

    const expense = rows[0];

    if (!expense) {
      return null;
    }

    let refunded = false;
    let balanceAfter = null;

    // Only an entry that actually moved money gets one back. A pending entry
    // never debited anything, and a source account that has since been deleted
    // leaves source_id null, so there is nowhere to return it to.
    if (expense.balance_updated && expense.source_id) {
      // RETURNING so callers can quote the resulting balance rather than
      // recomputing it from a value read before the update.
      const { rows: credited } = await client.query(
        `update balances set balance = balance + $1
          where id = $2 and user_id = $3
          returning balance`,
        [expense.amount, expense.source_id, userId]
      );

      refunded = credited.length > 0;
      balanceAfter = credited[0]?.balance ?? null;
    }

    // Counted before the delete, which unlinks them (on delete set null). They
    // stay as ordinary money in — that money did arrive — and the caller says so.
    const { rows: linked } = await client.query(
      'select count(*)::int as n from incomes where split_expense_id = $1',
      [expense.id]
    );

    await client.query('delete from expenses where id = $1', [expense.id]);

    return { ...expense, refunded, balanceAfter, detachedRepayments: linked[0].n };
  });
}
