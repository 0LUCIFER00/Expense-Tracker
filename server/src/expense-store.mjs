import { transaction } from './db.mjs';

const COLUMNS = `
  id, amount, description, spent_on, source_id, source_category,
  balance_updated, status, source_channel, loan_repayment_id
`;

/**
 * Interest paid on a debt is an expense filed by Lending & Borrowing. Removing
 * it on its own would leave the debt and the account disagreeing, so it is
 * undone by reversing the repayment there instead.
 */
export const LOAN_LINKED_MESSAGE =
  'This interest was recorded with a repayment in Lending & Borrowing. Reverse that repayment there instead.';

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
 *   canBackdate, status, members, split, remarks?, recurringRunId?,
 *   loanRepaymentId? } — the last links interest paid on a debt to its repayment
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
       split_members, split_share, personal_share, recurring_run_id, loan_repayment_id
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     returning ${returning}`,
    [
      userId, amount, entry.description, entry.date, entry.category,
      source?.id ?? null, source?.type ?? null, source?.category ?? null,
      updateBalance, entry.canBackdate, debit, status, remarks,
      entry.members ?? null, entry.split?.share ?? null, entry.split?.personal ?? null,
      entry.recurringRunId ?? null,
      entry.loanRepaymentId ?? null
    ]
  );

  return { ...rows[0], debited: debit };
}

/** How a removal is recorded: the account's normal sign-in, its full-access one, or WhatsApp. */
export const DELETED_VIA = new Set(['user', 'admin', 'whatsapp']);

/**
 * Removes an expense: it moves to Recently deleted, and any money it debited
 * is put back.
 *
 * Both the website's delete button and WhatsApp's "undo" go through here, so
 * the two cannot drift apart — deleting an entry that moved money must refund
 * it either way, otherwise the balances stop matching the expense list.
 *
 * The row is kept, marked deleted, with `delete_reversed` saying whether the
 * refund happened, so a restore takes the money out again exactly once. Its
 * receipts, repayments and every other link stay as they are; only deleting
 * it for good (recycle-store.mjs) removes the row.
 *
 * Pass `expenseId` to remove a specific entry, or `lastFromChannel` to remove
 * the most recent one that arrived over that channel. `via` records how.
 *
 * @returns the removed row plus `refunded` and `linkedRepayments`, or null
 *   when there was nothing to remove.
 */
export function removeExpense(userId, { expenseId = null, lastFromChannel = null, via = 'user' } = {}) {
  if (!DELETED_VIA.has(via)) {
    throw new Error(`Unknown deletion channel: ${via}`);
  }

  return transaction(async client => {
    const { rows } = expenseId
      ? await client.query(
          `select ${COLUMNS} from expenses
            where id = $1 and user_id = $2 and deleted_at is null
            for update`,
          [expenseId, userId]
        )
      : await client.query(
          `select ${COLUMNS} from expenses
            where user_id = $1 and source_channel = $2 and deleted_at is null
            order by created_at desc
            limit 1
            for update`,
          [userId, lastFromChannel]
        );

    const expense = rows[0];

    if (!expense) {
      return null;
    }

    if (expense.loan_repayment_id) {
      throw Object.assign(new Error(LOAN_LINKED_MESSAGE), { status: 409 });
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

    // Repayments made against it stay linked, so a restore brings the whole
    // split back. While it is in Recently deleted they still read as
    // repayments; deleting it for good unlinks them (on delete set null).
    const { rows: linked } = await client.query(
      `select count(*)::int as n from incomes
        where split_expense_id = $1 and deleted_at is null`,
      [expense.id]
    );

    await client.query(
      `update expenses
          set deleted_at = now(), deleted_by = $2, deleted_via = $3, delete_reversed = $4
        where id = $1`,
      [expense.id, userId, via, refunded]
    );

    return { ...expense, refunded, balanceAfter, linkedRepayments: linked[0].n };
  });
}
