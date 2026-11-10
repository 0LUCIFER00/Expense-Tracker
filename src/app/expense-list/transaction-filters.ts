/**
 * Search, filters and totals for the Transactions list.
 *
 * Pure functions over the rows the page already holds. The rows come from the
 * existing list APIs, which return only this account's entries, never deleted
 * ones, and only the account names this sign-in may see; nothing here can
 * widen that. Amounts are compared and totalled in whole paise.
 */
import { personalAmount } from '../shared/expense.service';
import type { TransactionRow } from './expense-list.component';

export type Period = 'all' | 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'custom';
/** A settled entry (every income is) or an expense waiting for approval. */
export type StatusFilter = 'approved' | 'pending';

/** Every filter the page offers. Text fields stay as typed; they are parsed when applied. */
export interface TransactionFilters {
  period: Period;
  /**
   * A calendar year (0 is every year; OLDER_YEARS is before the last five) and
   * a month of any year (1–12; 0 is every month), as the old Year and Month
   * menus offered. They narrow together, and the page keeps them apart from
   * `period` so the two never contradict each other.
   */
  year: number;
  month: number;
  /** YYYY-MM-DD, both ends included; used when period is 'custom'. Blank is open-ended. */
  from: string;
  to: string;
  /**
   * The lists below are "any of these": a row matches when it has one of the
   * ticked values. An empty list does not filter at all.
   */
  categories: string[];
  statuses: StatusFilter[];
  /** Account names; NO_ACCOUNT is entries with none. */
  accounts: string[];
  /** NO_ACCOUNT here means none recorded. */
  paymentMethods: string[];
  /** Rupees as typed ("1,250.50"); blank is no limit. */
  minAmount: string;
  maxAmount: string;
  search: string;
}

/** The filter value for "has none" (no account, no payment method). */
export const NO_ACCOUNT = '__none__';

/** The Year menu's "Older": anything before the five years it lists. */
export const OLDER_YEARS = -1;

/** How many recent years the Year menu lists. */
export const RECENT_YEARS = 5;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export const EMPTY_FILTERS: TransactionFilters = {
  period: 'all', year: 0, month: 0, from: '', to: '', categories: [], statuses: [], accounts: [],
  paymentMethods: [], minAmount: '', maxAmount: '', search: ''
};

/** The filters in the Filter menu beside the search, which wait for Apply. */
export const ADVANCED_KEYS = ['categories', 'statuses', 'accounts', 'paymentMethods', 'minAmount', 'maxAmount'] as const;
export type AdvancedKey = typeof ADVANCED_KEYS[number];
/** The multiple-choice ones among them. */
export type ListKey = 'categories' | 'statuses' | 'accounts' | 'paymentMethods';

export const PERIOD_LABELS: Record<Period, string> = {
  all: 'All time', today: 'Today', week: 'This week', month: 'This month',
  lastMonth: 'Last month', year: 'This year', custom: 'Custom range'
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseIso(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** A real calendar date in YYYY-MM-DD, or false. */
export function isIsoDate(value: string): boolean {
  if (!ISO.test(value)) return false;

  const date = parseIso(value);
  return iso(date) === value;
}

/**
 * The first and last day (both included) a period covers, by the device's
 * calendar. A week runs Monday to Sunday. Null ends are open.
 */
export function dateRange(period: Period, today: string, from = '', to = ''): { start: string | null; end: string | null } {
  const now = parseIso(today);

  switch (period) {
    case 'today':
      return { start: today, end: today };
    case 'week': {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: iso(monday), end: iso(sunday) };
    }
    case 'month':
      return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case 'lastMonth':
      return { start: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case 'year':
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
    case 'custom':
      return { start: isIsoDate(from) ? from : null, end: isIsoDate(to) ? to : null };
    default:
      return { start: null, end: null };
  }
}

/**
 * Rupees as typed into whole paise: "1,250.50" is 125050. Blank is null (no
 * limit); anything that is not a plain non-negative amount is NaN.
 */
export function parsePaise(text: string): number | null {
  const value = text.replace(/[₹,\s]/g, '');

  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return NaN;

  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

const toPaise = (rupees: number) => Math.round(Number(rupees) * 100);

/** Why these filters cannot be applied, or null when they can. */
export function filterProblem(f: TransactionFilters): string | null {
  const min = parsePaise(f.minAmount);
  const max = parsePaise(f.maxAmount);

  if (Number.isNaN(min)) return 'The minimum amount is not a number. Write it like 250 or 1,250.50.';
  if (Number.isNaN(max)) return 'The maximum amount is not a number. Write it like 250 or 1,250.50.';
  if (min !== null && max !== null && min > max) return 'The minimum amount is more than the maximum.';

  if (f.period === 'custom') {
    if (f.from && !isIsoDate(f.from)) return 'The start date is not a real date.';
    if (f.to && !isIsoDate(f.to)) return 'The end date is not a real date.';
    if (f.from && f.to && f.from > f.to) return 'The start date is after the end date.';
  }

  return null;
}

/** The payment method an entry carries (only imported entries have one). */
export function paymentMethodOf(row: TransactionRow): string | null {
  return row.expense?.imported?.paymentMethod ?? row.income?.imported?.paymentMethod ?? null;
}

/** The ways an amount might be typed: 1450.5, 1450.50, 1,450.50. */
function amountTexts(paise: number): string[] {
  const rupees = paise / 100;
  const fixed = rupees.toFixed(2);

  return [String(rupees), fixed, rupees.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
}

/** Everything a search can find a row by, lower-cased, one item per line. */
export function searchText(row: TransactionRow): string {
  const expense = row.expense;
  const income = row.income;
  const imported = expense?.imported ?? income?.imported;
  const parts = [
    row.description, row.category, row.account ?? '', row.status,
    imported?.notes ?? '', imported?.paymentMethod ?? '', imported?.fileName ?? '',
    expense?.remarks ?? '', income?.splitDescription ?? '',
    ...amountTexts(toPaise(row.amount))
  ];

  if (expense?.splitMembers) {
    parts.push(...amountTexts(toPaise(personalAmount(expense))));
  }

  return parts.join('\n').toLowerCase();
}

/**
 * True when every word of the search is found somewhere in the row (in any
 * order, any case, as part of a word). A number also matches without its ₹
 * and commas, so "1450" finds ₹1,450.50.
 */
export function matchesSearch(haystack: string, search: string): boolean {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return words.every(word => {
    if (haystack.includes(word)) return true;

    const bare = word.replace(/[₹,]/g, '');
    return bare !== word && bare !== '' && haystack.includes(bare);
  });
}

/** Ready-to-use limits for one pass over the rows. */
export interface CompiledFilters {
  start: string | null;
  end: string | null;
  /** The first year the Year menu lists; OLDER_YEARS means before it. */
  oldestListedYear: number;
  minPaise: number | null;
  maxPaise: number | null;
  f: TransactionFilters;
}

export function compile(f: TransactionFilters, today: string): CompiledFilters {
  const { start, end } = dateRange(f.period, today, f.from, f.to);
  const min = parsePaise(f.minAmount);
  const max = parsePaise(f.maxAmount);

  return {
    start,
    end,
    oldestListedYear: Number(today.slice(0, 4)) - RECENT_YEARS + 1,
    minPaise: Number.isNaN(min) ? null : min,
    maxPaise: Number.isNaN(max) ? null : max,
    f
  };
}

/**
 * True when a row passes every filter except the search, which the page
 * checks against a cached haystack.
 */
export function matchesFilters(row: TransactionRow, c: CompiledFilters): boolean {
  const { f } = c;

  if (c.start && row.date < c.start) return false;
  if (c.end && row.date > c.end) return false;

  const year = Number(row.date.slice(0, 4));
  if (f.year === OLDER_YEARS ? year >= c.oldestListedYear : f.year && year !== f.year) return false;
  if (f.month && Number(row.date.slice(5, 7)) !== f.month) return false;

  // Each list is "any of these"; together they are all required.
  if (f.categories.length && !f.categories.includes(row.category)) return false;

  const status: StatusFilter = row.expense?.isPendingApproval ? 'pending' : 'approved';
  if (f.statuses.length && !f.statuses.includes(status)) return false;

  if (f.accounts.length && !f.accounts.includes(row.account ?? NO_ACCOUNT)) return false;

  const method = paymentMethodOf(row) ?? NO_ACCOUNT;
  if (f.paymentMethods.length && !f.paymentMethods.includes(method)) return false;

  const paise = toPaise(row.amount);
  if (c.minPaise !== null && paise < c.minPaise) return false;
  if (c.maxPaise !== null && paise > c.maxPaise) return false;

  return true;
}

export interface FilteredTotals {
  /** Settled expenses only, and only the owner's share of a split. */
  expensePaise: number;
  /** Money in that is income; repayments of a split are not. */
  incomePaise: number;
  /** Repayments, shown on their own, in neither total. */
  repaidPaise: number;
  netPaise: number;
}

/**
 * The totals of a set of rows, by the same rules as the dashboard: a pending
 * expense has not been spent yet, a split counts only the owner's share, and a
 * repayment is neither income nor spending.
 */
export function totalsOf(rows: TransactionRow[]): FilteredTotals {
  let expensePaise = 0;
  let incomePaise = 0;
  let repaidPaise = 0;

  for (const row of rows) {
    if (row.expense) {
      if (row.expense.status === 'Done') {
        expensePaise += toPaise(personalAmount(row.expense));
      }
    } else if (row.income) {
      if (row.income.splitExpenseId) {
        repaidPaise += toPaise(row.amount);
      } else {
        incomePaise += toPaise(row.amount);
      }
    }
  }

  return { expensePaise, incomePaise, repaidPaise, netPaise: incomePaise - expensePaise };
}

export interface FilterChip {
  key: keyof TransactionFilters | 'range';
  /** For a list filter, the one value this chip removes. */
  value?: string;
  label: string;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseIso(value));
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** One removable chip per active filter, in the order they appear in the panel. */
export function chipsFor(f: TransactionFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (f.year) chips.push({ key: 'year', label: f.year === OLDER_YEARS ? 'Older years' : String(f.year) });
  if (f.month) chips.push({ key: 'month', label: MONTH_NAMES[f.month - 1] });

  if (f.period === 'custom') {
    if (f.from || f.to) {
      const label = f.from && f.to ? `${shortDate(f.from)} – ${shortDate(f.to)}`
        : f.from ? `From ${shortDate(f.from)}` : `Until ${shortDate(f.to)}`;
      chips.push({ key: 'range', label });
    }
  } else if (f.period !== 'all') {
    chips.push({ key: 'period', label: PERIOD_LABELS[f.period] });
  }

  // One chip per ticked value, so each can be taken off on its own.
  for (const value of f.categories) chips.push({ key: 'categories', value, label: value });
  for (const value of f.statuses) chips.push({ key: 'statuses', value, label: value === 'pending' ? 'Pending' : 'Approved' });
  for (const value of f.accounts) chips.push({ key: 'accounts', value, label: value === NO_ACCOUNT ? 'No account' : value });
  for (const value of f.paymentMethods) {
    chips.push({ key: 'paymentMethods', value, label: value === NO_ACCOUNT ? 'No payment method' : value });
  }

  const min = parsePaise(f.minAmount);
  const max = parsePaise(f.maxAmount);
  if (min !== null && !Number.isNaN(min)) chips.push({ key: 'minAmount', label: `At least ${rupees(min)}` });
  if (max !== null && !Number.isNaN(max)) chips.push({ key: 'maxAmount', label: `At most ${rupees(max)}` });

  if (f.search.trim()) chips.push({ key: 'search', label: `“${f.search.trim()}”` });

  return chips;
}

/** The filters with one chip taken off: one value of a list, or the whole filter. */
export function withoutChip(f: TransactionFilters, chip: FilterChip | FilterChip['key']): TransactionFilters {
  const { key, value } = typeof chip === 'string' ? { key: chip, value: undefined } : chip;

  if (key === 'range' || key === 'period') {
    return { ...f, period: 'all', from: '', to: '' };
  }

  const current = f[key];

  if (Array.isArray(current) && value !== undefined) {
    return { ...f, [key]: (current as string[]).filter(v => v !== value) };
  }

  return { ...f, [key]: EMPTY_FILTERS[key] };
}

/** A list with `value` added, or taken out when it is already there. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/** True when anything narrows the list (the tab aside). */
export function isNarrowed(f: TransactionFilters): boolean {
  return chipsFor(f).length > 0;
}
