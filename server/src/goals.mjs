/**
 * Savings goals: the arithmetic and input checks, with no database.
 *
 * Every amount here is whole paise (an integer). Every date is a calendar date
 * (YYYY-MM-DD) in India time; "today" comes from todayInIndia().
 */
import { parseDate, parseText } from './http.mjs';

export const ICONS = [
  'piggy', 'emergency', 'travel', 'home', 'vehicle',
  'gadget', 'education', 'health', 'gift', 'celebration'
];

export const STATUSES = ['active', 'paused', 'completed'];

/** The largest target or total: ₹99,99,99,999.99. */
export const TARGET_MAX_PAISE = 999_999_999_999;

/** The largest single contribution or withdrawal: ₹1,00,00,000. */
export const ENTRY_MAX_PAISE = 1_000_000_000;

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 300;
export const NOTE_MAX = 200;

/** How far ahead a target date may be. */
const AHEAD_YEARS = 50;

const DECIMAL = /^\d+(\.\d{1,2})?$/;

/**
 * Rupees from a request (a number or a plain decimal string, at most two
 * decimal places) as whole paise, or null when it is not a positive amount no
 * larger than `max` paise. No floating-point sum ever happens on the way.
 */
export function rupeesToPaise(value, max) {
  let text;

  if (typeof value === 'number' && Number.isFinite(value)) {
    text = value.toFixed(2);
    if (Math.abs(Number(text) - value) > 1e-9) return null; // more than 2 decimals
  } else if (typeof value === 'string' && DECIMAL.test(value.trim())) {
    text = value.trim();
  } else {
    return null;
  }

  const [whole, fraction = ''] = text.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > max) {
    return null;
  }

  return paise;
}

/**
 * Whole months from today until the target date, rounded up, at least 1:
 * 6 Nov → 31 Mar is 5, 6 Nov → 6 Dec is 1. Zero once the date has passed.
 */
export function monthsLeft(today, targetDate) {
  if (targetDate < today) {
    return 0;
  }

  const [y, m, d] = today.split('-').map(Number);
  const [ty, tm, td] = targetDate.split('-').map(Number);
  const months = (ty - y) * 12 + (tm - m) + (td > d ? 1 : 0);

  return Math.max(1, months);
}

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/**
 * Where a goal stands, worked out from its stored figures only.
 *
 * state is one of:
 *   completed, paused,
 *   reached     — saved at least the target (Mark complete is offered; it never completes itself),
 *   date-passed — the target date has gone and it is short,
 *   behind      — less saved than the share of time already used,
 *   on-track.
 */
export function goalView(goal, today) {
  const target = Number(goal.target_paise);
  const saved = Number(goal.saved_paise);
  const remaining = Math.max(0, target - saved);
  const months = monthsLeft(today, goal.target_date);

  let state;

  if (goal.status === 'completed') {
    state = 'completed';
  } else if (goal.status === 'paused') {
    state = 'paused';
  } else if (saved >= target) {
    state = 'reached';
  } else if (goal.target_date < today) {
    state = 'date-passed';
  } else {
    const total = dayNumber(goal.target_date) - dayNumber(goal.created_on);
    const used = dayNumber(today) - dayNumber(goal.created_on);
    // saved / target < used / total, without dividing.
    state = total > 0 && saved * total < target * used ? 'behind' : 'on-track';
  }

  const needsMonthly = remaining > 0 && months > 0 && goal.status !== 'completed';

  return {
    targetPaise: target,
    savedPaise: saved,
    remainingPaise: remaining,
    overPaise: Math.max(0, saved - target),
    // Whole per cent, floored, so 99.9% never shows as 100%.
    percent: Math.floor((saved * 100) / target),
    monthsLeft: months,
    monthlyPaise: needsMonthly ? Math.ceil(remaining / months) : null,
    state
  };
}

/** Which status changes are allowed, and what each is called. */
export const TRANSITIONS = {
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  complete: { from: ['active', 'paused'], to: 'completed' },
  reopen: { from: ['completed'], to: 'active' }
};

/**
 * A goal from a request body.
 *
 * Creating, the target date must be today or later. Editing, the date it
 * already has may stay even if it has passed; a new one must be today or later.
 *
 * @returns { value } or { error }
 */
export function readGoal(body, { today, creating, currentDate = null }) {
  const name = parseText(body?.name, { field: 'Name', max: NAME_MAX });
  if (name.error) return { error: name.error };

  const description = parseText(body?.description, {
    field: 'Description', max: DESCRIPTION_MAX, required: false
  });
  if (description.error) return { error: description.error };

  let icon = null;
  if (body?.icon !== undefined && body?.icon !== null && body?.icon !== '') {
    if (!ICONS.includes(body.icon)) return { error: 'Choose one of the icons.' };
    icon = body.icon;
  }

  const target = rupeesToPaise(body?.target, TARGET_MAX_PAISE);
  if (target === null) {
    return { error: 'Enter a target above ₹0 and no more than ₹99,99,99,999.99.' };
  }

  const targetDate = parseDate(body?.targetDate);
  if (!targetDate) return { error: 'Choose a target date.' };

  const [ty] = targetDate.split('-').map(Number);
  if (ty > Number(today.slice(0, 4)) + AHEAD_YEARS) {
    return { error: `Choose a target date within ${AHEAD_YEARS} years.` };
  }

  if (targetDate < today && !(!creating && targetDate === currentDate)) {
    return { error: 'The target date must be today or later.' };
  }

  let initial = 0;
  if (creating && body?.initialSaved !== undefined && body?.initialSaved !== null && body?.initialSaved !== '') {
    initial = rupeesToPaise(body.initialSaved, ENTRY_MAX_PAISE);
    if (initial === null) {
      return { error: 'Already saved must be above ₹0 and no more than ₹1,00,00,000, or left empty.' };
    }
  }

  return {
    value: {
      name: name.value,
      description: description.value || null,
      icon,
      targetPaise: target,
      targetDate,
      initialPaise: initial
    }
  };
}

/**
 * A contribution or withdrawal from a request body: an amount, a date no later
 * than today, and an optional note.
 */
export function readEntry(body, { today }) {
  const amount = rupeesToPaise(body?.amount, ENTRY_MAX_PAISE);
  if (amount === null) {
    return { error: 'Enter an amount above ₹0 and no more than ₹1,00,00,000.' };
  }

  let onDate = today;
  if (body?.date) {
    onDate = parseDate(body.date);
    if (!onDate || onDate > today || onDate < '2000-01-01') {
      return { error: 'Choose a date that is today or earlier.' };
    }
  }

  const note = parseText(body?.note, { field: 'Note', max: NOTE_MAX, required: false });
  if (note.error) return { error: note.error };

  return { value: { amountPaise: amount, onDate, note: note.value || null } };
}
