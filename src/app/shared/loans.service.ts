import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Loan, LoanDraft, LoanQuote, LoanRepayment, LoanStatus, LoansOverview, RepaymentDraft } from './models';

/**
 * Lending and borrowing. Every figure (what is owed, interest built up and
 * paid, status) comes from the API; the page only shows it. Each submission
 * carries a request id, so a double click or a retry is recorded once.
 */
@Injectable({ providedIn: 'root' })
export class LoansService {
  private readonly api = inject(ApiService);

  overview(): Observable<LoansOverview> {
    return this.api.get<LoansOverview>('/loans');
  }

  create(draft: LoanDraft): Observable<{ loan: Loan; balanceAfter: number; duplicate: boolean }> {
    return this.api.post('/loans', draft);
  }

  update(id: string, draft: LoanDraft): Observable<{ loan: Loan; balanceAfter: number | null }> {
    return this.api.put(`/loans/${id}`, draft);
  }

  quote(id: string, date: string): Observable<LoanQuote> {
    return this.api.get<LoanQuote>(`/loans/${id}/quote?date=${encodeURIComponent(date)}`);
  }

  repay(id: string, draft: RepaymentDraft): Observable<{ repayment: LoanRepayment; loan: Loan | null; duplicate: boolean }> {
    return this.api.post(`/loans/${id}/repayments`, draft);
  }

  /** Only the latest repayment on a record can be reversed. */
  reverse(id: string, repaymentId: string): Observable<{ repayment: LoanRepayment; loan: Loan | null }> {
    return this.api.post(`/loans/${id}/repayments/${repaymentId}/reverse`);
  }

  /** Reverses every repayment and the principal; the record stays, marked cancelled. */
  cancel(id: string, reason: string | null): Observable<{ loan: Loan; reversedRepayments: number }> {
    return this.api.post(`/loans/${id}/cancel`, { confirm: true, reason });
  }
}

/** A new id for each submission, so the server can tell a retry from a second entry. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  // Older browsers: a version-4 shape from Math.random, good enough to tell submissions apart.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: 'Active',
  partial: 'Partially paid',
  completed: 'Completed',
  overdue: 'Overdue',
  cancelled: 'Cancelled'
};

/** 10 Nov 2026. */
export function loanDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
