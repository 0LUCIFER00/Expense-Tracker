/**
 * Account transfers: input checks, with no database.
 *
 * Amounts become whole paise on the way in (no floating-point sum). A transfer
 * dated today needs nothing more; another past date needs "Change transaction
 * dates", as an expense or income does; a future date is refused, because
 * money that has not moved yet must not move the balances now.
 */
import { parseDate, parseText } from './http.mjs';
import { rupeesToPaise } from './goals.mjs';

/** The most one account can hold: numeric(14, 2). */
export const TRANSFER_MAX_PAISE = 999_999_999_999;

export const DESCRIPTION_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * @returns { value } or { error, status? } — status 403 for a date this
 *   sign-in may not use.
 */
export function readTransfer(body, { today, canBackdate }) {
  const fromId = body?.fromAccountId;
  const toId = body?.toAccountId;

  if (!isUuid(fromId) || !isUuid(toId)) {
    return { error: 'Choose the account to move money from and the one to move it to.' };
  }

  if (fromId === toId) {
    return { error: 'Choose two different accounts.' };
  }

  const amount = rupeesToPaise(body?.amount, TRANSFER_MAX_PAISE);

  if (amount === null) {
    return { error: 'Enter an amount above ₹0, with at most two decimal places.' };
  }

  const date = body?.date ? parseDate(body.date) : today;

  if (!date || date < '2000-01-01') {
    return { error: 'Choose a valid date.' };
  }

  if (date > today) {
    return { error: 'A transfer cannot be dated in the future.' };
  }

  if (date !== today && !canBackdate) {
    return {
      status: 403,
      error: 'Transfers can only be dated today on this sign-in. Earlier dates need ' +
        '"Change transaction dates", or your full-access password.'
    };
  }

  const description = parseText(body?.description, {
    field: 'Description', max: DESCRIPTION_MAX, required: false
  });

  if (description.error) {
    return { error: description.error };
  }

  const requestId = body?.requestId;

  if (requestId !== undefined && requestId !== null && !isUuid(requestId)) {
    return { error: 'That request could not be read. Please try again.' };
  }

  return {
    value: {
      fromId,
      toId,
      amountPaise: amount,
      date,
      description: description.value || null,
      requestId: requestId ?? null
    }
  };
}

/** Rupees and paise for a message: ₹1,234.50, or ₹1,234 when whole. */
export function money(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: paise % 100 ? 2 : 0 })}`;
}
