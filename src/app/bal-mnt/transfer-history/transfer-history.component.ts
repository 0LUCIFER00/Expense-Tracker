import { DecimalPipe } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { BalanceService } from '../../shared/balance.service';
import { AccountTransfer, BalanceAccount } from '../../shared/models';

/**
 * Transfers between the user's accounts, newest first, with an account and a
 * date-range filter. Shown apart from Transactions on purpose: a transfer is
 * neither income nor an expense.
 */
@Component({
  selector: 'app-transfer-history',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './transfer-history.component.html',
  styleUrl: './transfer-history.component.css'
})
export class TransferHistoryComponent implements OnChanges {
  private readonly balances = inject(BalanceService);

  @Input() accounts: BalanceAccount[] = [];
  /** Bumped by the page after a transfer, to reload. */
  @Input() refresh = 0;

  transfers: AccountTransfer[] = [];
  loading = true;
  error = '';

  account = '';
  from = '';
  to = '';

  /** Loads once, then again only after a transfer; a changed account list alone does not. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['refresh']) {
      this.load();
    }
  }

  get filtered(): boolean {
    return Boolean(this.account || this.from || this.to);
  }

  get total(): number {
    return this.transfers.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100;
  }

  clear(): void {
    this.account = '';
    this.from = '';
    this.to = '';
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';

    this.balances.transfers({ account: this.account || null, from: this.from || null, to: this.to || null })
      .pipe(catchError(error => {
        this.error = error.message;
        return of([] as AccountTransfer[]);
      }))
      .subscribe(transfers => {
        this.transfers = transfers;
        this.loading = false;
      });
  }

  dateLabel(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
  }
}
