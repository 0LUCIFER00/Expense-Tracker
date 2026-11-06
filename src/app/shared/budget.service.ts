import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { BudgetDraft, BudgetHistory, BudgetMonth, PreviousBudget } from './models';

/**
 * Monthly budgets. Every figure comes from the API, which works spending out
 * from the expenses with the app's own rule; nothing here adds anything up.
 *
 * Months are "YYYY-MM" keys; the helpers below move between them.
 */
@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly api = inject(ApiService);

  month(key: string): Observable<BudgetMonth> {
    return this.api.get<BudgetMonth>(`/budgets/${key}`);
  }

  /** Creates or replaces the whole month. */
  save(key: string, draft: BudgetDraft): Observable<BudgetMonth> {
    return this.api.put<BudgetMonth>(`/budgets/${key}`, draft);
  }

  removeCategory(key: string, category: string): Observable<BudgetMonth> {
    return this.api.delete<BudgetMonth>(`/budgets/${key}/categories/${encodeURIComponent(category)}`);
  }

  /** Removes the month's budget. The expenses themselves are untouched. */
  remove(key: string): Observable<BudgetMonth> {
    return this.api.delete<BudgetMonth>(`/budgets/${key}`);
  }

  /** The latest earlier budget, for "Copy from …". Null when there is none. */
  previous(key: string): Observable<PreviousBudget | null> {
    return this.api.get<PreviousBudget | null>(`/budgets/${key}/previous`);
  }

  categories(): Observable<string[]> {
    return this.api.get<string[]>('/budgets/categories');
  }

  history(endKey: string, months: number): Observable<BudgetHistory> {
    return this.api.get<BudgetHistory>(`/budgets/history?end=${endKey}&months=${months}`);
  }
}

/** This month's key, by the device's calendar. */
export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** The key `delta` months before (negative) or after `key`. */
export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);

  return currentMonthKey(date);
}

/** A key, if it is one: "YYYY-MM" with a real month. */
export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "November 2026", or with `short`, "Nov". */
export function monthLabel(key: string, short = false): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1, 1);

  return short
    ? date.toLocaleDateString('en-IN', { month: 'short' })
    : date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Days left in the month, today included; 0 for a month that is over. */
export function daysLeft(key: string, now = new Date()): number {
  const current = currentMonthKey(now);

  if (key < current) {
    return 0;
  }

  const [year, month] = key.split('-').map(Number);
  const length = new Date(year, month, 0).getDate();

  return key > current ? length : length - now.getDate() + 1;
}

/** The word that goes with a status, so it is never told by colour alone. */
export function statusWord(line: { status: string | null; spent: number; budget?: number; total?: number | null }): string {
  const limit = line.budget ?? line.total ?? 0;

  if (line.status === 'over') {
    return line.spent > limit ? 'Over' : 'Reached';
  }

  return line.status === 'near' ? 'Near limit' : 'On track';
}

/** "50% used", "Over budget"… for an alert in the list. */
export function alertLabel(threshold: number): string {
  if (threshold === 101) {
    return 'over budget';
  }

  return threshold === 100 ? 'budget reached' : `${threshold}% used`;
}
