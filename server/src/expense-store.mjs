import { transaction } from './db.mjs';

const COLUMNS = `
  id, amount, description, spent_on, source_id, source_category,
  balance_updated, status, source_channel
`;

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
