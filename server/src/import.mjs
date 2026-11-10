/**
 * Reading and checking rows from an imported CSV or Excel file.
 *
 * Pure, so the rules are what the tests exercise. The browser reads the file
 * and says which column is which; everything it sends is a raw cell, and every
 * decision about what a cell means is made here, once, for both the preview
 * and the import itself. The import re-checks each row, so a preview that has
 * gone stale (an account renamed, a balance spent) cannot slip a bad row in.
 */
import {
  CATEGORIES,
  INCOME_CATEGORIES,
  normaliseCategory,
  normaliseIncomeCategory
} from './categories.mjs';
import { AMOUNT_MAX } from './http.mjs';

/** Rows one file may hold. More than this is split into several files. */
export const IMPORT_MAX_ROWS = 2000;

/** Rows one import request may carry; the page sends a file in chunks of this. */
export const COMMIT_CHUNK_MAX = 100;

export const DESCRIPTION_MAX = 200;
export const NOTES_MAX = 300;
export const PAYMENT_METHOD_MAX = 60;

/** Nothing older is accepted: it is almost always a misread date. */
export const EARLIEST_DATE = '2000-01-01';

/** A cell longer than this is not a value anyone meant to import. */
const CELL_MAX = 1000;

/** The fields a row may carry, as the browser names them. */
export const FIELDS = [
  'date', 'description', 'amount', 'type', 'category', 'account', 'notes', 'paymentMethod'
];

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const SHORT_MONTH = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});

const rupees = paise =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Trims a cell and folds runs of whitespace (including a non-breaking space). */
export function cleanCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).replace(/[\s ]+/g, ' ').trim();
}

/** For comparing descriptions: case and spacing do not make a different entry. */
export function normaliseDescription(value) {
  return cleanCell(value).toLowerCase();
}

/** "5 Nov 2026", for messages. */
export function shortDate(iso) {
  return SHORT_MONTH.format(new Date(`${iso}T00:00:00Z`));
}

function monthFromName(word) {
  const lower = word.toLowerCase().replace(/\.$/, '');

  if (lower.length < 3) {
    return 0;
  }

  const index = MONTH_NAMES.findIndex(name =>
    name === lower || name.slice(0, 3) === lower || (name === 'september' && lower === 'sept'));

  return index + 1;
}

function fullYear(text) {
  return text.length === 2 ? 2000 + Number(text) : Number(text);
}

/** Excel counts days from 30 Dec 1899 (its 1900 leap-year bug folded in). */
function fromExcelSerial(serial) {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);

  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

const DATE_HELP = 'Use YYYY-MM-DD (2026-11-05) or day first, DD/MM/YYYY (05/11/2026).';

function readDateParts(text) {
  let match;

  // 2026-11-05, optionally followed by a time.
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text))) {
    return { y: +match[1], m: +match[2], d: +match[3] };
  }

  // 2026/11/05
  if ((match = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(text))) {
    return { y: +match[1], m: +match[2], d: +match[3] };
  }

  // An Excel date that arrived as its serial number (2000 to 2099).
  if ((match = /^(\d{5})(?:\.\d+)?$/.exec(text))) {
    const serial = Number(match[1]);

    if (serial >= 36526 && serial <= 73050) {
      return fromExcelSerial(serial);
    }

    return { error: `"${text}" is not a date. ${DATE_HELP}` };
  }

  // Day first: 05/11/2026, 5-11-2026, 05.11.26, optionally followed by a time.
  if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:\s.*)?$/.exec(text))) {
    const first = Number(match[1]);
    const second = Number(match[2]);

    // 11/25/2026 can only be month first, which this app does not read: a
    // date like 05/11 would silently become the wrong month.
    if (second > 12 && first <= 12) {
      return { error: `"${text}" looks like month first. ${DATE_HELP}` };
    }

    return { y: fullYear(match[3]), m: second, d: first };
  }

  // 5 Nov 2026, 05-Nov-2026, 5 November 26
  if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[\s/-]+([A-Za-z]+\.?),?[\s/-]+(\d{4}|\d{2})$/.exec(text))) {
    const month = monthFromName(match[2]);

    if (month) {
      return { y: fullYear(match[3]), m: month, d: Number(match[1]) };
    }
  }

  // Nov 5, 2026
  if ((match = /^([A-Za-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text))) {
    const month = monthFromName(match[1]);

    if (month) {
      return { y: Number(match[3]), m: month, d: Number(match[2]) };
    }
  }

  return { error: `Couldn't read the date "${text}". ${DATE_HELP}` };
}

/**
 * @param today the caller's today, YYYY-MM-DD; a later date is refused
 * @returns { value: 'YYYY-MM-DD' } or { error }
 */
export function parseImportDate(raw, today) {
  const text = cleanCell(raw);

  if (!text) {
    return { error: 'The date is missing.' };
  }

  const parts = readDateParts(text);

  if (parts.error) {
    return parts;
  }

  const { y, m, d } = parts;
  const date = new Date(Date.UTC(y, m - 1, d));

  if (
    m < 1 || m > 12 || d < 1 ||
    date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d
  ) {
    return { error: `"${text}" is not a real date.` };
  }

  const iso = date.toISOString().slice(0, 10);

  if (iso < EARLIEST_DATE) {
    return { error: `${shortDate(iso)} is too long ago; dates from 2000 on can be imported.` };
  }

  if (today && iso > today) {
    return { error: `${shortDate(iso)} is in the future.` };
  }

  return { value: iso };
}

const CURRENCY = /^(?:₹|rs\.?|inr)\s*/i;
const CURRENCY_AFTER = /\s*(?:₹|rs\.?|inr|\/-)$/i;

/**
 * Reads an amount into whole paise, without floating point: "1,250.50" is
 * 125050 exactly.
 *
 * Accepts ₹, Rs and INR, Indian or western digit grouping, a leading minus
 * and accounting brackets for a negative. Refuses a decimal comma (1.250,50),
 * since reading it either way risks a hundredfold mistake.
 *
 * @returns { paise, negative } or { error }
 */
export function parseImportAmount(raw) {
  let text = cleanCell(raw);

  if (!text) {
    return { error: 'The amount is missing.' };
  }

  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(CURRENCY, '');

  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1).trim().replace(CURRENCY, '');
  }

  text = text.replace(CURRENCY_AFTER, '').replace(/\s/g, '');

  if (/,\d{1,2}$/.test(text) && !text.includes('.')) {
    return { error: `"${cleanCell(raw)}" uses a comma for paise. Write it with a full stop, like 1250.50.` };
  }

  if (!/^\d{1,3}(,\d{2,3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(text)) {
    return { error: `"${cleanCell(raw)}" is not an amount. Write a plain number, like 1250 or 1250.50.` };
  }

  const [whole, fraction = ''] = text.replace(/,/g, '').split('.');

  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) {
    return { error: `${cleanCell(raw)} has more than two decimal places.` };
  }

  if (whole.length > 9) {
    return { error: `${cleanCell(raw)} is too large.` };
  }

  const paise = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));

  if (paise === 0) {
    return { error: 'The amount must be more than zero.' };
  }

  if (paise > AMOUNT_MAX * 100) {
    return { error: `${rupees(paise)} is over ${rupees(AMOUNT_MAX * 100)}, the most one entry can be.` };
  }

  return { paise, negative };
}

const KIND_WORDS = new Map([
  ...['expense', 'expenses', 'debit', 'dr', 'out', 'money out', 'spent', 'spend', 'withdrawal', 'paid', 'payment']
    .map(word => [word, 'expense']),
  ...['income', 'credit', 'cr', 'in', 'money in', 'received', 'deposit']
    .map(word => [word, 'income'])
]);

/** @returns 'expense', 'income', '' when blank, or null when not understood. */
export function parseKind(raw) {
  const text = normaliseDescription(raw).replace(/\.$/, '');

  if (!text) {
    return '';
  }

  return KIND_WORDS.get(text) ?? null;
}

/** Other spellings people use for the app's own categories. */
const EXPENSE_ALIASES = new Map([
  ['food', 'Food & Drink'], ['food and drink', 'Food & Drink'], ['food & drinks', 'Food & Drink'],
  ['dining', 'Food & Drink'], ['grocery', 'Groceries'], ['transport', 'Travel'],
  ['bills', 'Bills & Utilities'], ['utilities', 'Bills & Utilities'],
  ['bills and utilities', 'Bills & Utilities'], ['medical', 'Health'], ['healthcare', 'Health'],
  ['family', 'Family & Gifts'], ['gifts', 'Family & Gifts'], ['family and gifts', 'Family & Gifts']
]);

const INCOME_ALIASES = new Map([
  ['wages', 'Salary'], ['refunds', 'Refund'], ['gifts', 'Gift'],
  ['sold', 'Sold something'], ['sale', 'Sold something']
]);

/** What an export writes for an entry with no category. */
const NO_CATEGORY = new Set(['uncategorised', 'uncategorized', 'none', '-', 'n/a']);

/** @returns { value: name | null } or { error } */
export function matchCategory(raw, kind) {
  const text = cleanCell(raw);
  const lower = text.toLowerCase();

  if (!text || NO_CATEGORY.has(lower)) {
    return { value: null };
  }

  if (kind === 'income') {
    if (lower === 'repayment') {
      return {
        error: 'Repayments of a split bill are not imported. Record them from Add Income, against the split.'
      };
    }

    const value = normaliseIncomeCategory(text) ?? INCOME_ALIASES.get(lower) ?? null;

    if (value) {
      return { value };
    }

    return {
      error: normaliseCategory(text)
        ? `${normaliseCategory(text)} is an expense category, and this row is income.`
        : `"${text}" is not an income category.`
    };
  }

  const value = normaliseCategory(text) ?? EXPENSE_ALIASES.get(lower) ?? null;

  if (value) {
    return { value };
  }

  return {
    error: normaliseIncomeCategory(text)
      ? `${normaliseIncomeCategory(text)} is an income category, and this row is an expense.`
      : `"${text}" is not an expense category.`
  };
}

function accountKeys(account) {
  const name = normaliseDescription(account.category);
  const type = normaliseDescription(account.type);

  return [name, `${type} ${name}`, `${type} - ${name}`, `${name} (${type})`, `${name} - ${type}`];
}

/**
 * Finds the account a cell names, by the name it has on Cash & Accounts
 * (what an export writes), optionally with its type.
 *
 * @returns { account } , { account: null } when the cell is blank, or { error }
 */
export function matchAccount(raw, accounts) {
  const text = normaliseDescription(raw);

  if (!text) {
    return { account: null };
  }

  const hits = accounts.filter(account => accountKeys(account).includes(text));

  if (hits.length === 1) {
    return { account: hits[0] };
  }

  if (hits.length > 1) {
    return { error: `More than one account is called "${cleanCell(raw)}". Choose which one.` };
  }

  return { error: `There is no account called "${cleanCell(raw)}".` };
}

/** Same kind, day, amount and description: the same transaction. */
export function duplicateKey(kind, date, paise, description) {
  return `${kind}|${date}|${paise}|${normaliseDescription(description)}`;
}

/** A row's cells as strings, whatever the browser sent. */
export function readRawRow(input) {
  const row = { row: Number(input?.row) };

  for (const field of FIELDS) {
    const value = input?.[field];
    row[field] = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  row.allowDuplicate = input?.allowDuplicate === true;
  row.skip = input?.skip === true;

  return row;
}

/**
 * Everything one row means, or why it cannot be imported.
 *
 * @param raw     a readRawRow() result
 * @param context { today, defaultKind: 'expense'|'income'|'sign', accounts,
 *                  permissions, updateBalances }
 * @returns { row, kind, date, amountPaise, description, category, account,
 *   notes, paymentMethod, settle: 'done'|'pending', moves: 'debit'|'credit'|null,
 *   errors: [], info: [] }
 */
export function checkRow(raw, context) {
  const { today, defaultKind, accounts, permissions, updateBalances } = context;
  const errors = [];
  const info = [];
  const result = {
    row: raw.row,
    kind: null,
    date: null,
    amountPaise: null,
    description: '',
    category: null,
    account: null,
    notes: '',
    paymentMethod: '',
    settle: null,
    moves: null,
    errors,
    info
  };

  for (const field of FIELDS) {
    if (raw[field].length > CELL_MAX) {
      errors.push(`The ${field === 'paymentMethod' ? 'payment method' : field} cell is far too long.`);
      return result;
    }
  }

  // What kind of row: its own Type cell first, then the file-wide choice.
  const amount = parseImportAmount(raw.amount);
  const typed = raw.type === 'both' ? 'both' : parseKind(raw.type);

  if (typed === 'both') {
    errors.push('Both the money-out and money-in columns have an amount.');
  } else if (typed === null) {
    errors.push(`"${cleanCell(raw.type)}" is not Expense or Income.`);
  } else if (typed) {
    result.kind = typed;
  } else if (defaultKind === 'sign') {
    result.kind = amount.negative ? 'expense' : 'income';
  } else {
    result.kind = defaultKind === 'income' ? 'income' : 'expense';

    if (amount.negative) {
      errors.push('The amount is negative. Write amounts as positive numbers.');
    }
  }

  const date = parseImportDate(raw.date, today);

  if (date.error) {
    errors.push(date.error);
  } else {
    result.date = date.value;
  }

  if (amount.error) {
    errors.push(amount.error);
  } else {
    result.amountPaise = amount.paise;
  }

  let description = cleanCell(raw.description);

  // An export makes a cell that starts like a formula inert with an
  // apostrophe; take it off again so a round trip gives back the same text.
  if (/^'[=+\-@]/.test(description)) {
    description = description.slice(1);
  }

  if (!description) {
    errors.push('The description is missing.');
  } else if (description.length > DESCRIPTION_MAX) {
    errors.push(`The description is longer than ${DESCRIPTION_MAX} characters.`);
  } else {
    result.description = description;
  }

  result.notes = cleanCell(raw.notes);

  if (result.notes.length > NOTES_MAX) {
    errors.push(`The notes are longer than ${NOTES_MAX} characters.`);
  }

  result.paymentMethod = cleanCell(raw.paymentMethod);

  if (result.paymentMethod.length > PAYMENT_METHOD_MAX) {
    errors.push(`The payment method is longer than ${PAYMENT_METHOD_MAX} characters.`);
  }

  if (!result.kind) {
    return result;
  }

  const category = matchCategory(raw.category, result.kind);

  if (category.error) {
    errors.push(category.error);
  } else {
    result.category = category.value;
  }

  let account = matchAccount(raw.account, accounts);

  // A blank Account with a Payment Method that is itself an account's name
  // ("Cash") means that account; anything else in Payment Method is just kept.
  if (!account.error && !account.account && result.paymentMethod) {
    const byMethod = matchAccount(result.paymentMethod, accounts);

    if (byMethod.account) {
      account = byMethod;
      info.push(`Account taken from the payment method, ${byMethod.account.category}.`);
    }
  }

  if (account.error) {
    errors.push(account.error);
  } else {
    result.account = account.account;
  }

  const isToday = result.date === today;
  const name = result.account?.category;

  if (result.kind === 'income') {
    if (!permissions.canAddMoney) {
      errors.push('Adding money is switched off for this sign-in.');
    } else if (!permissions.canUpdateBalance) {
      errors.push('This sign-in cannot change balances, so it cannot add income.');
    } else if (!result.account && !account.error) {
      errors.push('Income needs the account it went into.');
    }

    if (result.date && !isToday && !permissions.canBackdate) {
      errors.push('Income for another day needs "Change transaction dates", or your full-access password.');
    }

    result.settle = 'done';

    if (result.account) {
      if (updateBalances) {
        result.moves = 'credit';
      } else {
        info.push(`Recorded without changing ${name}'s balance.`);
      }
    }

    return result;
  }

  result.settle = isToday || permissions.canBackdate ? 'done' : 'pending';

  if (result.settle === 'pending') {
    info.push('Waits for approval: this sign-in cannot add entries for other days.');
  }

  if (result.account) {
    if (!updateBalances) {
      info.push(`Listed against ${name} without taking money out of it.`);
    } else if (!permissions.canUpdateBalance) {
      info.push(`Listed against ${name} without taking money out: this sign-in cannot change balances.`);
    } else if (result.settle === 'done') {
      result.moves = 'debit';
    } else {
      info.push(`${name} is debited when it is approved.`);
    }
  }

  return result;
}

/**
 * Indexes the person's existing entries by duplicateKey.
 *
 * @param expenses [{ id, date, amount, description }] (amount in rupees)
 * @param incomes  the same, for money in
 */
export function indexExisting(expenses, incomes) {
  const index = new Map();

  for (const [kind, list] of [['expense', expenses], ['income', incomes]]) {
    for (const entry of list) {
      const key = duplicateKey(kind, entry.date, Math.round(Number(entry.amount) * 100), entry.description);

      if (!index.has(key)) {
        index.set(key, { kind, id: entry.id, date: entry.date, description: entry.description });
      }
    }
  }

  return index;
}

/** The order rows are imported in: oldest first, money in before money out on a day. */
export function importOrder(a, b) {
  if (a.date !== b.date) {
    return (a.date ?? '') < (b.date ?? '') ? -1 : 1;
  }

  if (a.kind !== b.kind) {
    return a.kind === 'income' ? -1 : 1;
  }

  return a.row - b.row;
}

/**
 * The whole preview: every row checked, duplicates found, and the balances
 * played forward so a row that would overdraw an account is caught now
 * rather than failing halfway through the import.
 *
 * Rows the person excluded (`skip`) are still checked and shown, but neither
 * move money in the play-forward nor count as the first of a duplicate pair.
 *
 * @param existing indexExisting() of the person's entries on the file's dates
 */
export function previewRows(rawRows, context, existing) {
  const checked = rawRows.map(raw => ({ ...checkRow(raw, context), raw }));
  const seen = new Map();

  for (const row of checked) {
    row.status = row.errors.length ? 'invalid' : 'ready';
    row.duplicateOf = null;

    if (row.status === 'invalid') {
      continue;
    }

    const key = duplicateKey(row.kind, row.date, row.amountPaise, row.description);
    const match = existing.get(key);

    if (match) {
      row.duplicateOf = { source: 'existing', date: match.date, description: match.description };
    } else if (seen.has(key)) {
      row.duplicateOf = { source: 'file', row: seen.get(key) };
    }

    if (row.duplicateOf) {
      row.status = 'duplicate';
    }

    if (!row.raw.skip && (!row.duplicateOf || row.raw.allowDuplicate) && !seen.has(key)) {
      seen.set(key, row.row);
    }
  }

  // Play the balances forward over what would actually be imported.
  const balances = new Map(context.accounts.map(account =>
    [account.id, Math.round(Number(account.balance) * 100)]));
  const going = checked
    .filter(row => !row.raw.skip && (row.status === 'ready' || (row.status === 'duplicate' && row.raw.allowDuplicate)))
    .sort(importOrder);

  for (const row of going) {
    if (!row.moves) {
      continue;
    }

    const id = row.account.id;
    const before = balances.get(id);

    if (row.moves === 'credit') {
      balances.set(id, before + row.amountPaise);
    } else if (before >= row.amountPaise) {
      balances.set(id, before - row.amountPaise);
    } else {
      row.errors.push(context.permissions.canSeeBalances
        ? `Not enough in ${row.account.category}: needs ${rupees(row.amountPaise)}, would have ${rupees(before)}.`
        : `Not enough in ${row.account.category} for this by then.`);
      row.status = 'invalid';
    }
  }

  return checked;
}

/** The counts and totals the page shows above the preview and in the confirmation. */
export function summarise(rows) {
  const summary = {
    total: rows.length,
    ready: 0,
    duplicates: 0,
    invalid: 0,
    excluded: 0,
    toImport: 0,
    expenses: { count: 0, paise: 0 },
    incomes: { count: 0, paise: 0 },
    pending: 0,
    accounts: []
  };
  const accounts = new Map();

  for (const row of rows) {
    if (row.status === 'ready') summary.ready += 1;
    if (row.status === 'duplicate') summary.duplicates += 1;
    if (row.status === 'invalid') summary.invalid += 1;

    const going = row.status === 'ready' || (row.status === 'duplicate' && row.raw.allowDuplicate);

    if (row.raw.skip) {
      summary.excluded += 1;
    }

    if (!going || row.raw.skip) {
      continue;
    }

    summary.toImport += 1;

    const bucket = row.kind === 'income' ? summary.incomes : summary.expenses;
    bucket.count += 1;
    bucket.paise += row.amountPaise;

    if (row.settle === 'pending') {
      summary.pending += 1;
    }

    if (row.moves) {
      const entry = accounts.get(row.account.id) ?? { name: row.account.category, changePaise: 0 };
      entry.changePaise += row.moves === 'credit' ? row.amountPaise : -row.amountPaise;
      accounts.set(row.account.id, entry);
    }
  }

  summary.accounts = [...accounts.values()];

  return summary;
}

/** A row as the page receives it. */
export function rowForApi(row) {
  return {
    row: row.row,
    status: row.status,
    kind: row.kind,
    date: row.date,
    amountPaise: row.amountPaise,
    description: row.description,
    category: row.category,
    accountId: row.account?.id ?? null,
    accountName: row.account?.category ?? null,
    notes: row.notes,
    paymentMethod: row.paymentMethod,
    settle: row.settle,
    moves: row.moves,
    errors: row.errors,
    info: row.info,
    duplicateOf: row.duplicateOf ?? null
  };
}

/** The categories either kind may use, for the page's correction menus. */
export const CATEGORY_LISTS = { expense: CATEGORIES, income: INCOME_CATEGORIES };
