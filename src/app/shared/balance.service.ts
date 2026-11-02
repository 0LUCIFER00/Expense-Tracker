import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { BalanceAccount } from './models';

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

  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/balances/${id}`);
  }
}
