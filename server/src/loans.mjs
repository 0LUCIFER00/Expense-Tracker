/**
 * Lending and borrowing: input checks and the arithmetic, with no database.
 *
 * Everything is whole paise. Interest is simple and never compounded: it runs
 * by the day on the principal still owed, at the stated rate (a monthly rate
 * counts twelve times a year), and interest left unpaid never earns interest
 * itself. A repayment pays the interest due first, then principal, and that
 * split is fixed when the repayment is recorded.
 *
 *   accrued interest = round( Σ principal owed × days × rate ÷ 365 )
 *
 * summed over the stretches between repayments, and rounded once, half up, so
 * the figure never drifts with the number of repayments.
 */
import { parseDate, parseText } from './http.mjs';
import { rupeesToPaise } from './goals.mjs';
import { isUuid } from './transfers.mjs';

/** The most one record can be for: what one account can hold, numeric(14, 2). */
export const LOAN_MAX_PAISE = 999_999_999_999;

export const NAME_MAX = 80;
export const CONTACT_MAX = 120;
export const NOTES_MAX = 300;
export const NOTE_MAX = 200;

/** 100.00% a month or a year, in hundredths of a percent. */
export const RATE_MAX_BP = 10_000;

export const DIRECTIONS = ['lent', 'borrowed'];
export const PERIODS = ['month', 'year'];

const DAY_MS = 86_400_000;
const RATE = /^\d{1,3}(\.\d{1,2})?$/;

/** Whole days from one YYYY-MM-DD to another (0 when `to` is not later). */
export function daysBetween(from, to) {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
  return Math.max(0, days);
}

/** A percentage with at most two decimals, as hundredths of a percent; null when not a valid rate. */
export function readRate(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : String(value ?? '').trim();

  if (!RATE.test(text)) {
    return null;
  }

  const [whole, fraction = ''] = text.split('.');
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return bp >= 1 && bp <= RATE_MAX_BP ? bp : null;
}

/** BigInt division rounded half up; both sides positive. */
function roundDiv(numerator, denominator) {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Where a loan stands on `asOf`, counting only repayments dated on or before
 * it that have not been reversed.
 *
 * @param loan { principal_paise, start_date, interest_type, interest_rate_bp, interest_period }
 * @param repayments active repayments, oldest first: { paid_on, principal_paise, interest_paise }
 */
export function standing(loan, repayments, asOf) {
  let owed = Number(loan.principal_paise);
  let from = loan.start_date;
  let principalDays = 0n; // Σ principal × days
  let principalRepaid = 0;
  let interestPaid = 0;

  for (const r of repayments) {
    if (r.paid_on > asOf) break;
    principalDays += BigInt(owed) * BigInt(daysBetween(from, r.paid_on));
    owed -= Number(r.principal_paise);
    principalRepaid += Number(r.principal_paise);
    interestPaid += Number(r.interest_paise);
    from = r.paid_on > from ? r.paid_on : from;
  }

  if (asOf > from) {
    principalDays += BigInt(owed) * BigInt(daysBetween(from, asOf));
  }

  let accrued = 0;

  if (loan.interest_type === 'simple' && principalDays > 0n) {
    const perYear = loan.interest_period === 'month' ? 12n : 1n;
    // rate_bp is hundredths of a percent: ÷ 10,000 for a fraction.
    accrued = Number(roundDiv(principalDays * BigInt(loan.interest_rate_bp) * perYear, 10_000n * 365n));
  }

  // Interest is always paid first, so what was paid can never pass what had built up.
  const interestOutstanding = Math.max(0, accrued - interestPaid);

  return {
    principalOutstanding: owed,
    principalRepaid,
    interestAccrued: accrued,
    interestPaid,
    interestOutstanding,
    outstanding: owed + interestOutstanding
  };
}

/**
 * How a repayment of `amountPaise` on `date` splits: interest due first, then
 * principal. Null (with a reason) when it is more than is owed.
 */
export function splitRepayment(loan, repayments, date, amountPaise) {
  const due = standing(loan, repayments, date);
  const interest = Math.min(amountPaise, due.interestOutstanding);
  const principal = amountPaise - interest;

  if (due.outstanding <= 0) {
    return { error: 'nothing-owed', due };
  }

  if (principal > due.principalOutstanding) {
    return { error: 'too-much', due };
  }

  return { interest, principal, due };
}

/**
 * The state a person sees: cancelled, completed, overdue, partly paid or active.
 */
export function loanStatus(loan, figures, repaymentCount, today) {
  if (loan.status === 'cancelled') return 'cancelled';
  if (figures.outstanding <= 0) return 'completed';
  if (loan.due_date && loan.due_date < today) return 'overdue';
  if (repaymentCount > 0) return 'partial';
  return 'active';
}

/** The interest line, as the page and the replies word it. */
export function interestLabel(loan) {
  if (loan.interest_type !== 'simple') return 'No interest';
  const rate = (loan.interest_rate_bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${rate}% a ${loan.interest_period}, simple`;
}

function readDate(value, { today, canBackdate, field, allowDefault = true }) {
  const date = value ? parseDate(value) : (allowDefault ? today : null);

  if (!date || date < '2000-01-01') {
    return { error: `Choose a valid ${field}.` };
  }

  if (date > today) {
    return { error: `The ${field} cannot be in the future.` };
  }

  if (date !== today && !canBackdate) {
    return {
      status: 403,
      error: 'Only today can be used on this sign-in. Earlier dates need ' +
        '"Change transaction dates", or your full-access password.'
    };
  }

  return { value: date };
}

function readRequestId(value) {
  if (value === undefined || value === null) return { value: null };
  return isUuid(value) ? { value } : { error: 'That request could not be read. Please try again.' };
}

/**
 * The interest settings: { type: 'none' } or { type: 'simple', rate, period }.
 */
export function readInterest(body) {
  const type = body?.type ?? 'none';

  if (type === 'none') {
    return { value: { type: 'none', rateBp: null, period: null } };
  }

  if (type !== 'simple') {
    return { error: 'Interest is either none or simple.' };
  }

  const rateBp = readRate(body?.rate);

  if (rateBp === null) {
    return { error: 'Enter an interest rate above 0% and up to 100%, with at most two decimal places.' };
  }

  if (!PERIODS.includes(body?.period)) {
    return { error: 'Choose whether the rate is per month or per year.' };
  }

  return { value: { type: 'simple', rateBp, period: body.period } };
}

/**
 * A new record, or the editable fields of an existing one.
 *
 * @returns { value } or { error, status? }
 */
export function readLoan(body, { today, canBackdate, creating, currentDate = null }) {
  const out = {};

  if (creating) {
    if (!DIRECTIONS.includes(body?.direction)) {
      return { error: 'Choose whether you gave or received the money.' };
    }

    out.direction = body.direction;

    if (!isUuid(body?.accountId)) {
      return {
        error: body.direction === 'lent'
          ? 'Choose the account the money was given from.'
          : 'Choose the account the money was received into.'
      };
    }

    out.accountId = body.accountId;

    const request = readRequestId(body?.requestId);
    if (request.error) return request;
    out.requestId = request.value;
  } else if (body?.accountId !== undefined && body?.accountId !== null) {
    out.accountId = body.accountId;
  }

  const name = parseText(body?.personName, { field: 'Name', max: NAME_MAX });
  if (name.error) return { error: name.error };
  out.personName = name.value;

  const contact = parseText(body?.contact, { field: 'Contact details', max: CONTACT_MAX, required: false });
  if (contact.error) return { error: contact.error };
  out.contact = contact.value || null;

  const principal = rupeesToPaise(body?.amount, LOAN_MAX_PAISE);
  if (principal === null) {
    return { error: 'Enter an amount above ₹0, with at most two decimal places.' };
  }
  out.principalPaise = principal;

  // An edit that leaves the date alone is not backdating, whatever the date is.
  const unchanged = !creating && currentDate && parseDate(body?.date) === currentDate;
  const date = unchanged ? { value: currentDate } : readDate(body?.date, { today, canBackdate, field: 'date' });
  if (date.error) return date;
  out.date = date.value;

  if (body?.dueDate) {
    const due = parseDate(body.dueDate);
    if (!due) return { error: 'Choose a valid expected repayment date.' };
    if (due < out.date) return { error: 'The expected repayment date cannot be before the money changed hands.' };
    out.dueDate = due;
  } else {
    out.dueDate = null;
  }

  const interest = readInterest(body?.interest);
  if (interest.error) return interest;
  out.interest = interest.value;

  const notes = parseText(body?.notes, { field: 'Notes', max: NOTES_MAX, required: false });
  if (notes.error) return { error: notes.error };
  out.notes = notes.value || null;

  return { value: out };
}

/** A repayment: amount, date, account, note, request id. */
export function readRepayment(body, { today, canBackdate }) {
  const amount = rupeesToPaise(body?.amount, LOAN_MAX_PAISE);

  if (amount === null) {
    return { error: 'Enter an amount above ₹0, with at most two decimal places.' };
  }

  if (!isUuid(body?.accountId)) {
    return { error: 'Choose the account for this repayment.' };
  }

  const date = readDate(body?.date, { today, canBackdate, field: 'payment date' });
  if (date.error) return date;

  const note = parseText(body?.note, { field: 'Note', max: NOTE_MAX, required: false });
  if (note.error) return { error: note.error };

  const request = readRequestId(body?.requestId);
  if (request.error) return request;

  return {
    value: {
      amountPaise: amount,
      accountId: body.accountId,
      date: date.value,
      note: note.value || null,
      requestId: request.value
    }
  };
}
