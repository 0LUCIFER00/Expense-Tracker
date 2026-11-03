import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Income, NewIncome } from './models';

/** What the server reports after money was added. */
export interface AddedIncome extends Income {
  /** The account's balance afterwards; null when amounts are hidden. */
  balanceAfter: number | null;
}

export interface RemovedIncome {
  id: string;
  /** True when the money was taken back out of the account. */
  reversed: boolean;
  targetCategory: string | null;
}

@Injectable({ providedIn: 'root' })
export class IncomeService {
  private readonly api = inject(ApiService);

  /** Cached: the category list is a constant, not per-account data. */
  private categories: Observable<string[]> | null = null;

  /** Newest first, which is the order the page shows them in. */
  list(): Observable<Income[]> {
    return this.api.get<Income[]>('/incomes');
  }

  /**
   * Where money can be filed as coming from.
   *
   * Fetched rather than duplicated here so the dropdown and the server's
   * validation cannot disagree about what is allowed.
   */
  listCategories(): Observable<string[]> {
    this.categories ??= this.api
      .get<string[]>('/incomes/categories')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));

    return this.categories;
  }

  /** Records it and credits the account in one go. */
  create(income: NewIncome): Observable<AddedIncome> {
    return this.api.post<AddedIncome>('/incomes', income);
  }

  /** Removing an entry takes the money back out, when the account still has it. */
  remove(id: string): Observable<RemovedIncome> {
    return this.api.delete<RemovedIncome>(`/incomes/${id}`);
  }

  totalOf(incomes: Income[]): number {
    return incomes.reduce((sum, income) => sum + Number(income.amount), 0);
  }
}
