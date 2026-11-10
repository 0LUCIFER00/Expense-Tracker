import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BalanceAccount, Loan, LoanQuote } from '../../shared/models';
import { loanDate } from '../../shared/loans.service';

export interface RepaymentSave {
  amount: number;
  accountId: string;
  date: string;
  note: string | null;
}

/**
 * A repayment: money back on a loan, or money paid back on a debt. Each one
 * names its own account, which need not be the one the record started with.
 *
 * What is owed on the chosen date comes from the server (the `quote`), and
 * the split shown is the server's rule: interest due first, then principal.
 */
@Component({
  selector: 'app-repayment-form',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './repayment-form.component.html',
  styleUrls: ['../loan-editor/loan-editor.component.css', './repayment-form.component.css']
})
export class RepaymentFormComponent implements OnInit {
  @Input({ required: true }) loan!: Loan;
  @Input() accounts: BalanceAccount[] = [];
  @Input() today = '';
  @Input() canBackdate = false;
  @Input() busy = false;
  @Input() quote: LoanQuote | null = null;
  @Input() serverError = '';

  @Output() save = new EventEmitter<RepaymentSave>();
  @Output() cancel = new EventEmitter<void>();
  /** Asks for what is owed on another date. */
  @Output() dateChange = new EventEmitter<string>();

  amount: number | null = null;
  accountId = '';
  date = '';
  note = '';
  error = '';

  readonly loanDate = loanDate;

  get lent(): boolean {
    return this.loan.direction === 'lent';
  }

  /** The earliest date allowed: not before the money changed hands or the last repayment. */
  get minDate(): string {
    const last = this.loan.lastPaidOn;
    return last && last > this.loan.date ? last : this.loan.date;
  }

  get account(): BalanceAccount | undefined {
    return this.accounts.find(a => a.id === this.accountId);
  }

  /** Interest first, then principal: how this amount would be counted. */
  get split(): { interest: number; principal: number } | null {
    const amount = Math.round(Number(this.amount) * 100);

    if (!this.quote || !(amount > 0)) {
      return null;
    }

    const interest = Math.min(amount, Math.round(this.quote.interestDue * 100));
    return { interest: interest / 100, principal: (amount - interest) / 100 };
  }

  ngOnInit(): void {
    this.date = this.today < this.minDate ? this.minDate : this.today;
    this.accountId = this.accounts.some(a => a.id === this.loan.accountId) ? this.loan.accountId : (this.accounts[0]?.id ?? '');
  }

  onDate(value: string): void {
    this.date = value;
    this.error = '';

    if (value && value >= this.minDate && value <= this.today) {
      this.dateChange.emit(value);
    }
  }

  fmt(value: number): string {
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  accountLabel(a: BalanceAccount): string {
    const original = a.id === this.loan.accountId ? ' (original)' : '';
    return a.balance === null ? a.category + original : `${a.category}${original} · ₹${this.fmt(a.balance)}`;
  }

  private problem(): string {
    const amount = Number(this.amount);

    if (!(amount > 0) || Math.round(amount * 100) !== Math.round(amount * 1e6) / 1e4) {
      return 'Enter an amount above ₹0 with at most two decimal places.';
    }
    if (!this.accountId) return 'Choose the account for this repayment.';
    if (!this.date || this.date > this.today) return 'Choose a date that is today or earlier.';
    if (this.date < this.minDate) return `Choose ${loanDate(this.minDate)} or later: repayments are counted in date order.`;
    if (this.quote && this.quote.date === this.date && amount > this.quote.totalDue) {
      return `Only ₹${this.fmt(this.quote.totalDue)} is owed on ${loanDate(this.date)}.`;
    }
    const balance = this.account?.balance;
    if (!this.lent && balance !== null && balance !== undefined && amount > balance) {
      return `${this.account!.category} holds ₹${this.fmt(balance)}, so it can't pay ₹${this.fmt(amount)}.`;
    }
    return '';
  }

  onSubmit(): void {
    this.error = this.problem();

    if (!this.error) {
      this.save.emit({ amount: Number(this.amount), accountId: this.accountId, date: this.date, note: this.note.trim() || null });
    }
  }
}
