import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Expense, NewExpense } from './models';

/** How an expense with no category of its own is labelled. */
export const UNCATEGORISED = 'Uncategorised';

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface RemovedExpense {
  id: string;
  /** True when a balance was credited back. */
  refunded: boolean;
  sourceCategory: string | null;
}

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private readonly api = inject(ApiService);

  /** Cached: the category list is a constant, not per-account data. */
  private categories: Observable<string[]> | null = null;

  /** Settled and pending entries, oldest first. */
  list(): Observable<Expense[]> {
    return this.api.get<Expense[]>('/expenses');
  }

  /**
   * The categories an expense may be filed under.
   *
   * Fetched rather than duplicated here so the dropdown and the server's
   * validation cannot disagree about what is allowed.
   */
  listCategories(): Observable<string[]> {
    this.categories ??= this.api
      .get<string[]>('/expenses/categories')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));

    return this.categories;
  }

  /**
   * The server decides whether this settles or queues for approval, based on
   * the date and the account's permissions.
   */
  create(expense: NewExpense): Observable<Expense> {
    return this.api.post<Expense>('/expenses', expense);
  }

  approve(id: string): Observable<Expense> {
    return this.api.post<Expense>(`/expenses/${id}/approve`);
  }

  /** Deleting an entry that debited an account also puts the money back. */
  remove(id: string): Observable<RemovedExpense> {
    return this.api.delete<RemovedExpense>(`/expenses/${id}`);
  }

  /**
   * Settled spending per category, largest first.
   *
   * Entries with no category are grouped under one bucket rather than dropped,
   * so the parts still add up to the total.
   */
  byCategory(expenses: Expense[]): CategoryTotal[] {
    const totals = new Map<string, number>();

    for (const expense of expenses) {
      if (expense.status !== 'Done') {
        continue;
      }

      const key = expense.category ?? UNCATEGORISED;
      totals.set(key, (totals.get(key) ?? 0) + Number(expense.amount));
    }

    return [...totals]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }

  /** Only settled entries count towards a total. */
  totalOf(expenses: Expense[]): number {
    return expenses
      .filter(expense => expense.status === 'Done')
      .reduce((sum, expense) => sum + Number(expense.amount), 0);
  }
}
