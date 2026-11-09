import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AccountTransfer, AccountUsage, BalanceAccount, TransferInput, TransferResult } from './models';

export interface BalanceInput {
  type: string;
  category: string;
  balance: number;
}

@Injectable({ providedIn: 'root' })
export class BalanceService {
  private readonly api = inject(ApiService);

  list(): Observable<BalanceAccount[]> {
    return this.api.get<BalanceAccount[]>('/balances');
  }

  create(input: BalanceInput): Observable<BalanceAccount> {
    return this.api.post<BalanceAccount>('/balances', input);
  }

  update(id: string, input: BalanceInput): Observable<BalanceAccount> {
    return this.api.put<BalanceAccount>(`/balances/${id}`, input);
  }

  /** Refused (409, with reasons) while the account holds money or has history. */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/balances/${id}`);
  }

  /** Whether an account can be deleted, and why not; asked before confirming. */
  usage(id: string): Observable<AccountUsage> {
    return this.api.get<AccountUsage>(`/balances/${id}/usage`);
  }

  /** Transfers, newest first, optionally for one account and a date range. */
  transfers(filters: { account?: string | null; from?: string | null; to?: string | null } = {}): Observable<AccountTransfer[]> {
    const params = Object.entries(filters)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&');

    return this.api.get<AccountTransfer[]>(`/transfers${params ? '?' + params : ''}`);
  }

  /**
   * Moves money between two accounts. `requestId` makes a retry of the same
   * submission harmless: the server processes it once.
   */
  transfer(input: TransferInput): Observable<TransferResult> {
    return this.api.post<TransferResult>('/transfers', input);
  }
}
