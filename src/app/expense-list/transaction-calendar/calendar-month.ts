/**
 * The month grid and per-day figures for the Transactions calendar.
 *
 * Pure. The rows are the ones the list already holds, after the same search,
 * filters and tab; the money is added up by totalsOf, the list's own rule (your
 * share of settled spending, income without repayments). Nothing here sums
 * money its own way. Entries are placed by their stored date (YYYY-MM-DD),
 * which is a calendar day, so no time zone can move one to another day.
 */
import type { TransactionRow } from '../expense-list.component';
import { FilteredTotals, totalsOf } from '../transaction-filters';

/** 'YYYY-MM'. */
export type MonthKey = string;

export interface CalendarCell {
  iso: string;
  day: number;
  /** False for the days of the months either side that fill the first and last weeks. */
  inMonth: boolean;
}

export interface DaySummary {
  totals: FilteredTotals;
  rows: TransactionRow[];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function monthOf(iso: string): MonthKey {
  return iso.slice(0, 7);
}

/** The month `delta` months away: December of the year before, January of the next. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;

  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number);

  return new Date(y, m, 0).getDate();
}

/**
 * Whole weeks, Monday first, covering the month: 4 to 6 rows of 7. The days
 * before the 1st and after the last belong to the neighbouring months.
 */
export function monthGrid(month: MonthKey): CalendarCell[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  // getDay(): Sunday 0 … Saturday 6; Monday-first puts Sunday last.
  const lead = (first.getDay() + 6) % 7;
  const length = daysInMonth(month);
  const total = Math.ceil((lead + length) / 7) * 7;
  const cells: CalendarCell[] = [];

  for (let i = 0; i < total; i += 1) {
    const date = new Date(y, m - 1, 1 - lead + i);
    const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

    cells.push({ iso, day: date.getDate(), inMonth: i >= lead && i < lead + length });
  }

  return cells;
}

/** The rows in a month, by day, each day totalled by the list's own rules. */
export function summariseDays(rows: TransactionRow[], month: MonthKey): Map<string, DaySummary> {
  const byDay = new Map<string, TransactionRow[]>();

  for (const row of rows) {
    if (row.date.slice(0, 7) !== month) continue;

    const list = byDay.get(row.date) ?? [];
    list.push(row);
    byDay.set(row.date, list);
  }

  const days = new Map<string, DaySummary>();

  for (const [iso, list] of byDay) {
    days.set(iso, { rows: list, totals: totalsOf(list) });
  }

  return days;
}

/** At least this many days with spending before any can stand out. */
export const HIGH_SPEND_MIN_DAYS = 3;

/**
 * What counts as a high-spending day this month: more than twice the average
 * of the days that had any spending (your share). Days with nothing spent do
 * not pull the average down, and with fewer than three spending days there is
 * nothing to compare against, so none is marked.
 *
 * @returns the average in paise (for the explanation) and the days above twice it
 */
export function highSpendDays(days: Map<string, DaySummary>): { averagePaise: number; thresholdPaise: number; days: Set<string> } {
  const spending = [...days.entries()].filter(([, d]) => d.totals.expensePaise > 0);

  if (spending.length < HIGH_SPEND_MIN_DAYS) {
    return { averagePaise: 0, thresholdPaise: 0, days: new Set() };
  }

  const averagePaise = Math.round(spending.reduce((sum, [, d]) => sum + d.totals.expensePaise, 0) / spending.length);
  const thresholdPaise = averagePaise * 2;

  return {
    averagePaise,
    thresholdPaise,
    days: new Set(spending.filter(([, d]) => d.totals.expensePaise > thresholdPaise).map(([iso]) => iso))
  };
}

export function monthLabel(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);

  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
