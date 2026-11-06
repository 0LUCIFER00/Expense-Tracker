/** Shared helpers for the route modules. */

/** Forwards a rejected promise to Express's error handler. */
export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

export function notFound(res, message = 'Not found') {
  return res.status(404).json({ error: message });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The practical ceiling for an address; the RFC limit is 254. */
const EMAIL_MAX = 254;

/** Lower-cases and validates; returns null when it is not an email. */
export function normaliseEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();

  if (email.length > EMAIL_MAX) {
    return null;
  }

  return EMAIL_PATTERN.test(email) ? email : null;
}

/** The largest single amount either channel accepts. */
export const AMOUNT_MAX = 100_000;

/** A plain decimal: digits, optionally a point and more digits. */
const DECIMAL_TEXT = /^\d+(\.\d+)?$/;

/**
 * Parses a positive money amount, or null when it is not one.
 *
 * Only a number or a plain decimal string. Number() alone turned `true` into 1,
 * `[5]` into 5 and "0x10" into 16, and accepted 0.001, which rounds to nothing
 * and then failed the database's amount > 0 check as a 500.
 */
export function parseAmount(value, { max = AMOUNT_MAX } = {}) {
  let amount;

  if (typeof value === 'number') {
    amount = value;
  } else if (typeof value === 'string' && DECIMAL_TEXT.test(value.trim())) {
    amount = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isFinite(amount) || amount > max) {
    return null;
  }

  // Money is numeric(14,2) in the database.
  const rounded = Math.round(amount * 100) / 100;

  return rounded > 0 ? rounded : null;
}

/**
 * Trims a free-text field and rejects one that is empty or over `max`.
 *
 * The columns are `text`, so without this the only ceiling is the 100kb body
 * limit: a description of that size would be stored happily and then break
 * every table, export and WhatsApp reply that tried to show it. The limits are
 * generous enough that nothing a person actually types is refused.
 *
 * @returns { value } or { error }
 */
export function parseText(raw, { field, max, required = true }) {
  const value = String(raw ?? '').trim();

  if (!value) {
    return required ? { error: `${field} is required` } : { value: '' };
  }

  if (value.length > max) {
    return { error: `${field} must be ${max} characters or fewer` };
  }

  return { value };
}

/**
 * "Today" according to the caller's clock. The browser sends its UTC offset so
 * that someone just after midnight locally does not have their entry treated
 * as a future date by a server running in UTC.
 */
export function callerToday(offsetMinutes) {
  const offset = Number(offsetMinutes);
  const safeOffset = Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0;

  // getTimezoneOffset() is minutes *behind* UTC, hence the subtraction.
  const local = new Date(Date.now() - safeOffset * 60_000);

  return local.toISOString().slice(0, 10);
}

/**
 * Today's date in India, as YYYY-MM-DD.
 *
 * For WhatsApp, where no browser says what time it is. The database and the
 * server run in UTC, so "today" by their clock is yesterday for the first five
 * and a half hours of every Indian day: a chai at 1am was filed under the day
 * before, and "today" listed the wrong day.
 */
export function todayInIndia(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** Accepts YYYY-MM-DD and rejects anything else. */
export function parseDate(value) {
  const text = String(value ?? '').slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const parsed = new Date(`${text}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) ? null : text;
}
