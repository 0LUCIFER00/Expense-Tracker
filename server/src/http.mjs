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

/** Parses a positive money amount, or null when it is not one. */
export function parseAmount(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    return null;
  }

  // Money is numeric(14,2) in the database.
  return Math.round(amount * 100) / 100;
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

/** Accepts YYYY-MM-DD and rejects anything else. */
export function parseDate(value) {
  const text = String(value ?? '').slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const parsed = new Date(`${text}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) ? null : text;
}
