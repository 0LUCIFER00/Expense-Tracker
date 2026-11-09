/**
 * Recurring schedules: the date arithmetic and input checks, with no database.
 *
 * Every date is a plain calendar date (YYYY-MM-DD) in India, the app's
 * timezone; "today" comes from todayInIndia(). No Date is ever turned into a
 * local time, so the server's own timezone cannot shift anything.
 */
import { AMOUNT_MAX, parseAmount, parseDate, parseText } from './http.mjs';
import { normaliseCategory, normaliseIncomeCategory } from './categories.mjs';

export const KINDS = ['expense', 'income'];
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
export const REMIND_DAYS = [0, 1, 3, 7];
export const INTERVAL_MAX = 99;
export const DESCRIPTION_MAX = 200;

/** How many missed dates one schedule catches up in a single pass. */
export const MAX_CATCH_UP = 31;

/** A failed occurrence is tried this many times automatically, once a day. */
export const MAX_ATTEMPTS = 3;

/** How far ahead a schedule may start. */
const AHEAD_DAYS = 2 * 366;

const DAY_MS = 86_400_000;

function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function toIso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dayNumber(iso) {
  const { y, m, d } = parts(iso);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function addDays(iso, days) {
  const date = new Date((dayNumber(iso) + days) * DAY_MS);
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The date of occurrence number `seq`, counting the anchor as 0.
 *
 * Months and years are counted from the anchor, never from the previous date:
 * a schedule anchored on 31 January falls on 28 (or 29) February and is back
 * on 31 March. One anchored on 29 February falls on 28 February in other years.
 */
export function occurrenceDate({ frequency, interval_count: interval = 1, anchor_on: anchor }, seq) {
  if (frequency === 'daily' || frequency === 'weekly') {
    const step = interval * (frequency === 'weekly' ? 7 : 1);
    return addDays(anchor, seq * step);
  }

  const { y, m, d } = parts(anchor);
  const months = seq * interval * (frequency === 'yearly' ? 12 : 1);
  const index = (m - 1) + months;
  const year = y + Math.floor(index / 12);
  const month = (index % 12) + 1;

  return toIso(year, month, Math.min(d, daysInMonth(year, month)));
}

/** The first occurrence number whose date is on or after `date`. */
export function firstSeqOnOrAfter(schedule, date) {
  const { frequency, interval_count: interval = 1, anchor_on: anchor } = schedule;

  if (date <= anchor) {
    return 0;
  }

  let seq;

  if (frequency === 'daily' || frequency === 'weekly') {
    const step = interval * (frequency === 'weekly' ? 7 : 1);
    seq = Math.ceil(daysBetween(anchor, date) / step);
  } else {
    const a = parts(anchor);
    const b = parts(date);
    const months = (b.y - a.y) * 12 + (b.m - a.m);
    seq = Math.max(0, Math.floor(months / (interval * (frequency === 'yearly' ? 12 : 1))));
  }

  // The estimate can be one short at a month end; step forward to be sure.
  while (occurrenceDate(schedule, seq) < date) {
    seq += 1;
  }

  return seq;
}

/**
 * Where the schedule stands after occurrence `seq` has come due: the next
 * number and date, or completed when that date is past the end date.
 */
export function advance(schedule, seq) {
  const nextSeq = seq + 1;
  const next = occurrenceDate(schedule, nextSeq);

  if (schedule.end_on && next > schedule.end_on) {
    return { next_seq: nextSeq, next_due_on: null, status: 'completed' };
  }

  return { next_seq: nextSeq, next_due_on: next, status: 'active' };
}

/** The next `count` dates from occurrence `seq`, stopping at the end date. */
export function upcomingDates(schedule, seq, count) {
  const dates = [];

  for (let i = seq; dates.length < count; i += 1) {
    const date = occurrenceDate(schedule, i);

    if (schedule.end_on && date > schedule.end_on) {
      break;
    }

    dates.push(date);
  }

  return dates;
}

/** About how much one schedule moves in a month, in paise. */
export function monthlyPaise({ frequency, interval_count: interval = 1, amount }) {
  const paise = Math.round(Number(amount) * 100);
  const perYear = { daily: 365, weekly: 52, monthly: 12, yearly: 1 }[frequency];

  return Math.round((paise * perYear) / 12 / interval);
}

/** Whether today falls in the schedule's reminder window. */
export function inReminderWindow(schedule, today) {
  if (schedule.status !== 'active' || schedule.remind_days === null || schedule.remind_days === undefined) {
    return false;
  }

  if (!schedule.next_due_on || schedule.next_due_on < today) {
    return false;
  }

  return daysBetween(today, schedule.next_due_on) <= schedule.remind_days;
}

const money = paise =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function whenText(today, date) {
  const days = daysBetween(today, date);

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';

  const { y, m, d } = parts(date);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'UTC'
  });

  return `on ${label}`;
}

/** One reminder line, for WhatsApp. */
export function reminderLine(schedule, today) {
  const amount = money(Math.round(Number(schedule.amount) * 100));
  const verb = schedule.kind === 'income' ? 'is expected' : 'is due';

  return `🔔 ${schedule.description} ${amount} ${verb} ${whenText(today, schedule.next_due_on)}.`;
}

/** One line about an occurrence that could not be added, for WhatsApp. */
export function failedLine(run) {
  const amount = money(Math.round(Number(run.amount) * 100));
  const { y, m, d } = parts(run.due_on);
  const due = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'UTC'
  });

  return `⚠️ ${run.description} ${amount} (due ${due}) was not added: ${run.last_error ?? 'it failed'} ` +
    'Open Recurring to try again or skip it.';
}

/**
 * Checks a schedule from a request body.
 *
 * `creating` reads `startOn`; an edit reads `nextDueOn` instead, the date the
 * schedule continues from. Either has to be today or later unless the sign-in
 * may change transaction dates: otherwise a schedule would be a way to
 * backdate entries.
 *
 * @returns { value } or { error } (with `status` 403 for a permission refusal)
 */
export function readSchedule(body, { today, canBackdate, creating, kind: fixedKind = null }) {
  const kind = fixedKind ?? body?.kind;

  if (!KINDS.includes(kind)) {
    return { error: 'Choose expense or income.' };
  }

  const description = parseText(body?.description, { field: 'Description', max: DESCRIPTION_MAX });

  if (description.error) {
    return { error: description.error };
  }

  const amount = parseAmount(body?.amount);

  if (amount === null) {
    return { error: `Enter an amount above ₹0 and no more than ₹${AMOUNT_MAX.toLocaleString('en-IN')}.` };
  }

  let category = null;

  if (body?.category) {
    category = kind === 'income'
      ? normaliseIncomeCategory(body.category)
      : normaliseCategory(body.category);

    if (!category) {
      return { error: 'That is not one of the categories.' };
    }
  }

  const accountId = body?.accountId ? String(body.accountId) : null;

  if (kind === 'income' && !accountId) {
    return { error: 'Choose the account the money goes into.' };
  }

  if (!FREQUENCIES.includes(body?.frequency)) {
    return { error: 'Choose how often it repeats.' };
  }

  const interval = body?.interval === undefined || body?.interval === null || body?.interval === ''
    ? 1
    : Number(body.interval);

  if (!Number.isInteger(interval) || interval < 1 || interval > INTERVAL_MAX) {
    return { error: `Repeat every 1 to ${INTERVAL_MAX}.` };
  }

  const dateField = creating ? 'startOn' : 'nextDueOn';
  const from = parseDate(body?.[dateField]);

  if (!from) {
    return { error: creating ? 'Choose a start date.' : 'Choose the next date.' };
  }

  if (daysBetween(today, from) > AHEAD_DAYS) {
    return { error: 'Start no more than two years ahead.' };
  }

  if (from < today && !canBackdate) {
    return {
      status: 403,
      error: 'Start today or later. Earlier dates need "Change transaction dates" or your full-access password.'
    };
  }

  let endOn = null;

  if (body?.endOn) {
    endOn = parseDate(body.endOn);

    if (!endOn || endOn < from) {
      return { error: 'The end date must be on or after the first date.' };
    }
  }

  let remindDays = null;

  if (body?.remindDays !== undefined && body?.remindDays !== null && body?.remindDays !== '') {
    remindDays = Number(body.remindDays);

    if (!REMIND_DAYS.includes(remindDays)) {
      return { error: 'Choose when to be reminded.' };
    }
  }

  return {
    value: {
      kind,
      description: description.value,
      amount,
      category,
      accountId,
      frequency: body.frequency,
      interval,
      from,
      endOn,
      remindDays
    }
  };
}
