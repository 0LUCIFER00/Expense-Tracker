import { transaction } from './db.mjs';
import { lockSplit } from './split-store.mjs';

const COLUMNS = `
  id, amount, description, received_on, category,
  target_id, target_type, target_category, balance_updated, source_channel, created_at,
  split_expense_id
`;

const money = value => `₹${Number(value).toLocaleString('en-IN')}`;

export const INCOME_COLUMNS = COLUMNS;

/**
 * Records money coming in, crediting the account in the same transaction.
 *
 * Shared by the website and WhatsApp, so the two cannot drift apart: both
 * record the entry and move the money together, or neither does.
 *
 * With `splitExpenseId` it is someone paying back their part of a split
 * expense, rather than income. It is refused when that split has nothing left
 * owing, or less than this — which is almost always the same repayment being
 * recorded twice.
 *
 * @returns the stored row plus `balanceAfter`, which comes from the UPDATE
 *   rather than being recomputed, so a reply can quote the real figure; and
 *   `split`, the split as it stands afterwards, when this was a repayment.
 */
export function addIncome(userId, entry) {
  return transaction(async client => {
    /*
     * The split is locked before the account. removeExpense takes the expense
     * first and the balance second; taking them in the other order here would
     * let a repayment and a removal each hold what the other is waiting for.
     */
    let split = null;

    if (entry.splitExpenseId) {
      split = await lockSplit(client, userId, entry.splitExpenseId);

      if (!split) {
        throw Object.assign(new Error('That split expense was not found.'), { status: 400 });
      }

      if (split.remaining <= 0) {
        throw Object.assign(
          new Error(`${split.description} is already fully paid back.`),
          { status: 409 }
        );
      }

      if (Number(entry.amount) > split.remaining) {
        throw Object.assign(
          new Error(
            `Only ${money(split.remaining)} is still owed on ${split.description}, ` +
            `not ${money(entry.amount)}.`
          ),
          { status: 409 }
        );
      }
    }

    let target = null;

    if (entry.targetId) {
      // Locked for the same reason an expense locks it: two credits landing at
      // once must not both read the same starting balance.
      const { rows } = await client.query(
        `select id, type, category, balance
           from balances
          where id = $1 and user_id = $2 and saved = true
          for update`,
        [entry.targetId, userId]
      );

      target = rows[0] ?? null;

      if (!target) {
        throw Object.assign(new Error('Please select a valid account.'), { status: 400 });
      }
    }

    const credit = Boolean(target);
    let balanceAfter = null;

    if (credit) {
      const { rows } = await client.query(
        `update balances set balance = balance + $1
          where id = $2 and user_id = $3
          returning balance`,
        [entry.amount, target.id, userId]
      );

      balanceAfter = rows[0]?.balance ?? null;
    }

    const { rows } = await client.query(
      `insert into incomes (
         user_id, amount, description, received_on, category,
         target_id, target_type, target_category, balance_updated, source_channel,
         split_expense_id
       )
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning ${COLUMNS}`,
      [
        userId, entry.amount, entry.description, entry.receivedOn,
        // A repayment is not income from anywhere, so it is not filed as one.
        split ? null : entry.category,
        target?.id ?? null, target?.type ?? null, target?.category ?? null,
        credit, entry.channel ?? 'web',
        split?.id ?? null
      ]
    );

    // As it stands with this repayment counted, for the reply.
    const after = split && {
      ...split,
      received: Math.round((split.received + Number(entry.amount)) * 100) / 100,
      remaining: Math.max(0, Math.round((split.remaining - Number(entry.amount)) * 100) / 100)
    };

    return { ...rows[0], balanceAfter, split: after };
  });
}

/**
 * Removes money that came in, taking it back out of the account.
 *
 * The mirror of removeExpense, and used by both the website's delete button and
 * WhatsApp's "undo". The balance is allowed to go no lower than zero in this
 * app, so a credit that has since been spent cannot always be taken back — the
 * caller is told which happened.
 *
 * Pass `incomeId` to remove a specific entry, or `lastFromChannel` for the most
 * recent one that arrived over that channel.
 *
 * @returns the removed row plus `reversed`, or null when there was nothing.
 */
export function removeIncome(userId, { incomeId = null, lastFromChannel = null } = {}) {
  return transaction(async client => {
    const { rows } = incomeId
      ? await client.query(
          `select ${COLUMNS} from incomes
            where id = $1 and user_id = $2
            for update`,
          [incomeId, userId]
        )
      : await client.query(
          `select ${COLUMNS} from incomes
            where user_id = $1 and source_channel = $2
            order by created_at desc
            limit 1
            for update`,
          [userId, lastFromChannel]
        );

    const income = rows[0];

    if (!income) {
      return null;
    }

    let reversed = false;
    let balanceAfter = null;
    let shortfall = false;

    if (income.balance_updated && income.target_id) {
      const { rows: current } = await client.query(
        'select balance from balances where id = $1 and user_id = $2 for update',
        [income.target_id, userId]
      );

      const balance = current[0] ? Number(current[0].balance) : null;

      if (balance === null) {
        // The account has since been deleted; there is nowhere to take it from.
      } else if (balance < Number(income.amount)) {
        // Taking it back would push the account below zero, which the schema
        // forbids. The entry stays, so the books still balance.
        shortfall = true;
      } else {
        const { rows: debited } = await client.query(
          `update balances set balance = balance - $1
            where id = $2 and user_id = $3
            returning balance`,
          [income.amount, income.target_id, userId]
        );

        reversed = debited.length > 0;
        balanceAfter = debited[0]?.balance ?? null;
      }
    }

    if (shortfall) {
      return { ...income, reversed: false, shortfall: true, balanceAfter: null };
    }

    await client.query('delete from incomes where id = $1', [income.id]);

    return { ...income, reversed, shortfall: false, balanceAfter };
  });
}
