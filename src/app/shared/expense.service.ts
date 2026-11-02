import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Expense, NewExpense } from './models';

export interface RemovedExpense {
  id: string;
  /** True when a balance was credited back. */
  refunded: boolean;
  sourceCategory: string | null;
}

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private readonly api = inject(ApiService);

  /** Settled and pending entries, oldest first. */
  list(): Observable<Expense[]> {
    return this.api.get<Expense[]>('/expenses');
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

  /** Only settled entries count towards a total. */
  totalOf(expenses: Expense[]): number {
    return expenses
      .filter(expense => expense.status === 'Done')
      .reduce((sum, expense) => sum + Number(expense.amount), 0);
  }
}
