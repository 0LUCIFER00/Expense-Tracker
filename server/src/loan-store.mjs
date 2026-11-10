/**
 * Lending and borrowing in the database.
 *
 * Every change is one transaction. The loan row is locked first (FOR UPDATE),
 * then the account rows it touches, in id order, so two requests on the same
 * loan or account queue up rather than both reading the same balance. A
 * request id seen before is answered with what it did the first time, after
 * the locks, so a retried submission cannot move money twice.
 *
 * Principal never touches expenses or income. The interest part of a
 * repayment is written through insertIncome / insertExpense, the same code
 * Add Income and Add Expense use, so it counts as income or an expense
 * exactly once, and is linked back to its repayment.
 */
import { query, transaction } from './db.mjs';
import { insertExpense } from './expense-store.mjs';
import { insertIncome } from './income-store.mjs';
import { money } from './transfers.mjs';
import { LOAN_MAX_PAISE, splitRepayment, standing } from './loans.mjs';

const LOAN_COLUMNS = `
  id, request_id, direction, person_name, contact, principal_paise, start_date, due_date,
  account_id, account_type, account_name, interest_type, interest_rate_bp, interest_period,
  notes, status, cancelled_at, cancel_reason, created_at, updated_at
`;

const REPAYMENT_COLUMNS = `
  id, loan_id, request_id, amount_paise, principal_paise, interest_paise, paid_on,
  account_id, account_type, account_name, note, reversed_at, reversed_reason, created_at
`;

/** Interest paid on a debt is filed under this expense category. */
export const INTEREST_EXPENSE_CATEGORY = 'Other';
/** Interest received on a loan is filed under this income category. */
export const INTEREST_INCOME_CATEGORY = 'Interest';

function refuse(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

/** bigint arrives as text; every amount here fits a safe integer. */
function loanRow(r) {
  return r && { ...r, principal_paise: Number(r.principal_paise) };
}

function repaymentRow(r) {
  return r && {
    ...r,
    amount_paise: Number(r.amount_paise),
    principal_paise: Number(r.principal_paise),
    interest_paise: Number(r.interest_paise)
  };
}

/** A balance, numeric(14, 2), as whole paise. */
const paiseOf = balance => Math.round(Number(balance) * 100);

/** Paise as the decimal text a numeric(14, 2) parameter takes. */
const rupeesText = paise => (paise / 100).toFixed(2);

async function lockLoan(client, userId, loanId) {
  const { rows: [loan] } = await client.query(
    `select ${LOAN_COLUMNS} from loans where id = $1 and user_id = $2 for update`,
    [loanId, userId]
  );

  return loanRow(loan) ?? null;
}

async function activeRepayments(client, loanId) {
  const { rows } = await client.query(
    `select ${REPAYMENT_COLUMNS} from loan_repayments
      where loan_id = $1 and reversed_at is null
      order by paid_on, created_at`,
    [loanId]
  );

  return rows.map(repaymentRow);
}

/**
 * The user's saved accounts among `ids`, locked in id order. Refuses when any
 * is missing, not theirs, or not a saved (spendable) account.
 */
async function lockAccounts(client, userId, ids) {
  const unique = [...new Set(ids)];
  const { rows } = await client.query(
    `select id, type, category, balance, saved
       from balances
      where user_id = $1 and id = any($2::uuid[])
      order by id
      for update`,
    [userId, unique]
  );

  const byId = new Map(rows.map(r => [r.id, r]));

  for (const id of unique) {
    const account = byId.get(id);

    if (!account || !account.saved) {
      throw refuse('Choose one of your saved accounts.', 400);
    }
  }

  return byId;
}

/** Moves `paise` into (+) or out of (−) an account already locked; refuses rather than go below zero or past the cap. */
async function move(client, userId, account, signedPaise) {
  const current = paiseOf(account.balance);

  if (signedPaise < 0 && current < -signedPaise) {
    throw refuse(`Not enough in ${account.category}: it holds ${money(current)}.`);
  }

  if (signedPaise > 0 && current + signedPaise > LOAN_MAX_PAISE) {
    throw refuse(`That would take ${account.category} past the most an account can hold.`, 400);
  }

  const { rows: [updated] } = await client.query(
    `update balances set balance = balance + ($1::bigint::numeric / 100)
      where id = $2 and user_id = $3
      returning balance`,
    [signedPaise, account.id, userId]
  );

  // Keep the locked copy current, for a second move in the same transaction.
  account.balance = updated.balance;
  return Number(updated.balance);
}

/**
 * Records money lent (debits the account) or borrowed (credits it).
 *
 * @returns { loan, balanceAfter, duplicate }
 */
export function createLoan(userId, v) {
  return transaction(async client => {
    const accounts = await lockAccounts(client, userId, [v.accountId]);
    const account = accounts.get(v.accountId);

    if (v.requestId) {
      const { rows: [existing] } = await client.query(
        `select ${LOAN_COLUMNS} from loans where user_id = $1 and request_id = $2`,
        [userId, v.requestId]
      );

      if (existing) {
        return { loan: loanRow(existing), balanceAfter: Number(account.balance), duplicate: true };
      }
    }

    // Lending takes it out of the account; borrowing puts it in.
    const balanceAfter = await move(client, userId, account, v.direction === 'lent' ? -v.principalPaise : v.principalPaise);

    const { rows: [loan] } = await client.query(
      `insert into loans (
         user_id, request_id, direction, person_name, contact, principal_paise, start_date, due_date,
         account_id, account_type, account_name, interest_type, interest_rate_bp, interest_period, notes
       )
       values ($1, coalesce($2::uuid, gen_random_uuid()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning ${LOAN_COLUMNS}`,
      [
        userId, v.requestId, v.direction, v.personName, v.contact, v.principalPaise, v.date, v.dueDate,
        account.id, account.type, account.category,
        v.interest.type, v.interest.rateBp, v.interest.period, v.notes
      ]
    );

    return { loan: loanRow(loan), balanceAfter, duplicate: false };
  });
}

/** Every record and every repayment (reversed ones included), for the page. */
export async function listLoans(userId) {
  const [{ rows: loans }, { rows: repayments }] = await Promise.all([
    query(
      `select ${LOAN_COLUMNS} from loans where user_id = $1 order by start_date desc, created_at desc`,
      [userId]
    ),
    query(
      `select ${REPAYMENT_COLUMNS} from loan_repayments where user_id = $1 order by paid_on, created_at`,
      [userId]
    )
  ]);

  return { loans: loans.map(loanRow), repayments: repayments.map(repaymentRow) };
}

/** One record with its active repayments, or null when it is not this user's. */
export async function findLoan(userId, loanId) {
  const { rows: [loan] } = await query(
    `select ${LOAN_COLUMNS} from loans where id = $1 and user_id = $2`,
    [loanId, userId]
  );

  if (!loan) {
    return null;
  }

  const { rows } = await query(
    `select ${REPAYMENT_COLUMNS} from loan_repayments
      where loan_id = $1 and reversed_at is null
      order by paid_on, created_at`,
    [loanId]
  );

  return { loan: loanRow(loan), repayments: rows.map(repaymentRow) };
}

/**
 * Records a repayment against a loan: interest due first, then principal.
 * Money lent coming back credits the chosen account; money paid back on a
 * debt debits it, and is refused when the account does not hold enough.
 *
 * @returns { repayment, balanceAfter, duplicate }
 */
export function addRepayment(userId, loanId, v, { canBackdate }) {
  return transaction(async client => {
    const loan = await lockLoan(client, userId, loanId);

    if (!loan) {
      throw refuse('That record was not found.', 404);
    }

    const accounts = await lockAccounts(client, userId, [v.accountId]);
    const account = accounts.get(v.accountId);

    if (v.requestId) {
      const { rows: [existing] } = await client.query(
        `select ${REPAYMENT_COLUMNS} from loan_repayments where user_id = $1 and request_id = $2`,
        [userId, v.requestId]
      );

      if (existing) {
        return { repayment: repaymentRow(existing), balanceAfter: Number(account.balance), duplicate: true };
      }
    }

    if (loan.status === 'cancelled') {
      throw refuse('This record was cancelled, so it takes no more repayments.');
    }

    const repayments = await activeRepayments(client, loan.id);
    const last = repayments.at(-1);

    if (v.date < loan.start_date) {
      throw refuse('A repayment cannot be dated before the money changed hands.', 400);
    }

    // Interest is worked out in date order; an earlier date would rewrite
    // how every later repayment was split.
    if (last && v.date < last.paid_on) {
      throw refuse(`The last repayment was on ${last.paid_on}. A new one cannot be dated earlier.`, 400);
    }

    const split = splitRepayment(loan, repayments, v.date, v.amountPaise);

    if (split.error === 'nothing-owed') {
      throw refuse('This is already fully repaid.');
    }

    if (split.error) {
      throw refuse(`Only ${money(split.due.outstanding)} is owed on ${v.date}, not ${money(v.amountPaise)}.`);
    }

    const lent = loan.direction === 'lent';

    // Money back on a loan comes in; paying back a debt goes out. The whole
    // amount is checked first, so the interest entry can never be refused
    // halfway through.
    if (!lent && paiseOf(account.balance) < v.amountPaise) {
      throw refuse(`Not enough in ${account.category}: it holds ${money(paiseOf(account.balance))}.`);
    }

    const { rows: [repayment] } = await client.query(
      `insert into loan_repayments (
         loan_id, user_id, request_id, amount_paise, principal_paise, interest_paise, paid_on,
         account_id, account_type, account_name, note
       )
       values ($1, $2, coalesce($3::uuid, gen_random_uuid()), $4, $5, $6, $7, $8, $9, $10, $11)
       returning ${REPAYMENT_COLUMNS}`,
      [
        loan.id, userId, v.requestId, v.amountPaise, split.principal, split.interest, v.date,
        account.id, account.type, account.category, v.note
      ]
    );

    let balanceAfter = Number(account.balance);

    // Principal: the account only. Never income, never an expense.
    if (split.principal > 0) {
      balanceAfter = await move(client, userId, account, lent ? split.principal : -split.principal);
    }

    // Interest: an ordinary income or expense entry, which moves its own part.
    if (split.interest > 0) {
      if (lent) {
        const income = await insertIncome(client, userId, {
          amount: rupeesText(split.interest),
          description: `Interest from ${loan.person_name}`,
          receivedOn: v.date,
          category: INTEREST_INCOME_CATEGORY,
          targetId: account.id,
          channel: 'web',
          loanRepaymentId: repayment.id
        });
        balanceAfter = Number(income.balanceAfter ?? balanceAfter);
      } else {
        await insertExpense(client, userId, {
          amount: Number(rupeesText(split.interest)),
          description: `Interest paid to ${loan.person_name}`,
          date: v.date,
          category: INTEREST_EXPENSE_CATEGORY,
          sourceId: account.id,
          updateBalance: true,
          canBackdate,
          status: 'done',
          members: null,
          split: null,
          remarks: 'Interest on a debt, from Lending & Borrowing; balance updated',
          loanRepaymentId: repayment.id
        });
        balanceAfter = paiseOf(account.balance) / 100 - split.interest / 100;
      }
    }

    return { repayment: repaymentRow(repayment), balanceAfter, duplicate: false };
  });
}

/**
 * Undoes one repayment inside the caller's transaction, with its accounts
 * already locked: the money goes back where it came from, the interest entry
 * leaves the totals, and the repayment is marked, not deleted.
 */
async function reverseOne(client, userId, loan, repayment, accounts, { via, reason }) {
  const account = accounts.get(repayment.account_id);
  const lent = loan.direction === 'lent';

  // A lent repayment had come in, so it goes back out (refused when the
  // account has since been spent below it); a debt repayment comes back in.
  await move(client, userId, account, lent ? -repayment.amount_paise : repayment.amount_paise);

  if (repayment.interest_paise > 0) {
    const table = lent ? 'incomes' : 'expenses';

    // Marked deleted with its money already put back (delete_reversed), so it
    // leaves every total. The bin and restore leave loan entries alone.
    await client.query(
      `update ${table}
          set deleted_at = now(), deleted_by = $2, deleted_via = $3, delete_reversed = true
        where loan_repayment_id = $1 and user_id = $2 and deleted_at is null`,
      [repayment.id, userId, via]
    );
  }

  const { rows: [reversed] } = await client.query(
    `update loan_repayments set reversed_at = now(), reversed_reason = $2
      where id = $1
      returning ${REPAYMENT_COLUMNS}`,
    [repayment.id, reason]
  );

  return repaymentRow(reversed);
}

/**
 * Reverses the latest repayment on a loan. Only the latest: interest was
 * split in date order, so undoing an earlier one would change the later ones.
 */
export function reverseRepayment(userId, loanId, repaymentId, { via }) {
  return transaction(async client => {
    const loan = await lockLoan(client, userId, loanId);

    if (!loan) {
      throw refuse('That record was not found.', 404);
    }

    const { rows: [target] } = await client.query(
      `select ${REPAYMENT_COLUMNS} from loan_repayments where id = $1 and loan_id = $2 for update`,
      [repaymentId, loan.id]
    );

    if (!target) {
      throw refuse('That repayment was not found.', 404);
    }

    if (target.reversed_at) {
      throw refuse('That repayment has already been reversed.');
    }

    const repayments = await activeRepayments(client, loan.id);

    if (repayments.at(-1)?.id !== target.id) {
      throw refuse('Reverse the later repayments first: interest is worked out in date order.');
    }

    const accounts = await lockAccounts(client, userId, [target.account_id]);
    const repayment = await reverseOne(client, userId, loan, repaymentRow(target), accounts, { via, reason: 'reversed' });

    return { repayment, balanceAfter: Number(accounts.get(target.account_id).balance) };
  });
}

/**
 * Changes a record. Name, contact, expected date and notes can always change.
 * The amount, date and interest only while no repayment is recorded, and a
 * changed amount moves the original account by the difference. The account
 * itself never changes: cancel and record it again instead.
 */
export function updateLoan(userId, loanId, v) {
  return transaction(async client => {
    const loan = await lockLoan(client, userId, loanId);

    if (!loan) {
      throw refuse('That record was not found.', 404);
    }

    if (loan.status === 'cancelled') {
      throw refuse('A cancelled record cannot be changed.');
    }

    if (v.accountId && v.accountId !== loan.account_id) {
      throw refuse('The account cannot be changed, as that would leave both balances wrong. Cancel this record and add it again instead.', 400);
    }

    const repayments = await activeRepayments(client, loan.id);
    const termsChanged =
      v.principalPaise !== loan.principal_paise ||
      v.date !== loan.start_date ||
      v.interest.type !== loan.interest_type ||
      v.interest.rateBp !== (loan.interest_rate_bp ?? null) ||
      v.interest.period !== (loan.interest_period ?? null);

    if (termsChanged && repayments.length > 0) {
      throw refuse('The amount, date and interest are fixed once a repayment is recorded. Reverse the repayments first to change them.');
    }

    if (v.dueDate && v.dueDate < v.date) {
      throw refuse('The expected repayment date cannot be before the money changed hands.', 400);
    }

    let balanceAfter = null;
    const delta = v.principalPaise - loan.principal_paise;

    if (delta !== 0) {
      const accounts = await lockAccounts(client, userId, [loan.account_id]);
      // Lending more takes more out; borrowing more puts more in.
      balanceAfter = await move(client, userId, accounts.get(loan.account_id), loan.direction === 'lent' ? -delta : delta);
    }

    const { rows: [updated] } = await client.query(
      `update loans
          set person_name = $3, contact = $4, principal_paise = $5, start_date = $6, due_date = $7,
              interest_type = $8, interest_rate_bp = $9, interest_period = $10, notes = $11
        where id = $1 and user_id = $2
        returning ${LOAN_COLUMNS}`,
      [
        loan.id, userId, v.personName, v.contact, v.principalPaise, v.date, v.dueDate,
        v.interest.type, v.interest.rateBp, v.interest.period, v.notes
      ]
    );

    return { loan: loanRow(updated), balanceAfter };
  });
}

/**
 * Cancels a record: every repayment is reversed, newest first, and the
 * principal goes back (lent: into the original account; borrowed: out of it).
 * All in one transaction, refused as a whole if any account cannot cover its
 * part. The record and its repayments stay, marked.
 */
export function cancelLoan(userId, loanId, { via, reason = null }) {
  return transaction(async client => {
    const loan = await lockLoan(client, userId, loanId);

    if (!loan) {
      throw refuse('That record was not found.', 404);
    }

    if (loan.status === 'cancelled') {
      throw refuse('This record is already cancelled.');
    }

    const repayments = await activeRepayments(client, loan.id);
    const accounts = await lockAccounts(client, userId, [loan.account_id, ...repayments.map(r => r.account_id)]);

    for (const repayment of repayments.slice().reverse()) {
      await reverseOne(client, userId, loan, repayment, accounts, { via, reason: 'cancelled' });
    }

    await move(client, userId, accounts.get(loan.account_id), loan.direction === 'lent' ? loan.principal_paise : -loan.principal_paise);

    const { rows: [cancelled] } = await client.query(
      `update loans set status = 'cancelled', cancelled_at = now(), cancel_reason = $3
        where id = $1 and user_id = $2
        returning ${LOAN_COLUMNS}`,
      [loan.id, userId, reason]
    );

    return {
      loan: loanRow(cancelled),
      reversed: repayments.length,
      balances: Object.fromEntries([...accounts.values()].map(a => [a.id, Number(a.balance)]))
    };
  });
}

/** What is owed on `date`, for the repayment form; null when not this user's. */
export async function quoteLoan(userId, loanId, date) {
  const found = await findLoan(userId, loanId);

  if (!found) {
    return null;
  }

  const due = standing(found.loan, found.repayments, date);
  return { loan: found.loan, due, lastPaidOn: found.repayments.at(-1)?.paid_on ?? null };
}
