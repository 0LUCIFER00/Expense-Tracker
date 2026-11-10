import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BalanceAccount, InterestPeriod, Loan, LoanDirection, LoanDraft } from '../../shared/models';

const MAX = 99_99_99_999.99;

/**
 * Money given or received: who, how much, when, from or into which account,
 * and any interest. The server moves the account and refuses lending more
 * than it holds; this form checks what was typed and says what will happen.
 *
 * Editing keeps the account fixed, and the amount, date and interest fixed
 * once a repayment is recorded, so the balances can never end up wrong.
 */
@Component({
  selector: 'app-loan-editor',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './loan-editor.component.html',
  styleUrl: './loan-editor.component.css'
})
export class LoanEditorComponent implements OnInit {
  /** The record being changed, or null for a new one. */
  @Input() loan: Loan | null = null;
  @Input() direction: LoanDirection = 'lent';
  /** Saved accounts, with their balances. */
  @Input() accounts: BalanceAccount[] = [];
  @Input() today = '';
  @Input() canBackdate = false;
  @Input() busy = false;
  /** The server's refusal, shown in place. */
  @Input() serverError = '';

  @Output() save = new EventEmitter<LoanDraft>();
  @Output() cancel = new EventEmitter<void>();

  personName = '';
  contact = '';
  amount: number | null = null;
  date = '';
  accountId = '';
  dueDate = '';
  withInterest = false;
  rate: number | null = null;
  period: InterestPeriod = 'month';
  notes = '';
  error = '';

  get editing(): boolean {
    return this.loan !== null;
  }

  get lent(): boolean {
    return this.direction === 'lent';
  }

  /** The amount, date and interest: fixed while repayments exist. */
  get termsLocked(): boolean {
    return this.editing && !this.loan!.termsEditable;
  }

  get account(): BalanceAccount | undefined {
    return this.accounts.find(a => a.id === this.accountId);
  }

  /** What the account can give: its balance, plus what this record already took when editing. */
  get available(): number | null {
    const balance = this.account?.balance;

    if (balance === null || balance === undefined) {
      return null;
    }

    return this.editing && this.lent ? balance + this.loan!.principal : balance;
  }

  /** The account's balance after saving, when it can be shown. */
  get after(): number | null {
    const amount = Number(this.amount);
    const balance = this.account?.balance;

    if (!(amount > 0) || balance === null || balance === undefined) {
      return null;
    }

    const change = this.editing ? amount - this.loan!.principal : amount;
    const paise = Math.round(balance * 100) + (this.lent ? -1 : 1) * Math.round(change * 100);
    return paise / 100;
  }

  ngOnInit(): void {
    const l = this.loan;

    if (l) {
      this.direction = l.direction;
      this.personName = l.personName;
      this.contact = l.contact ?? '';
      this.amount = l.principal;
      this.date = l.date;
      this.accountId = l.accountId;
      this.dueDate = l.dueDate ?? '';
      this.withInterest = l.interest.type === 'simple';
      this.rate = l.interest.rate;
      this.period = l.interest.period ?? 'month';
      this.notes = l.notes ?? '';
    } else {
      this.date = this.today;
      this.accountId = this.accounts.length === 1 ? this.accounts[0].id : '';
    }
  }

  setDirection(direction: LoanDirection): void {
    if (!this.editing) {
      this.direction = direction;
      this.error = '';
    }
  }

  fmt(value: number): string {
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  accountLabel(a: BalanceAccount): string {
    return a.balance === null ? a.category : `${a.category} · ₹${this.fmt(a.balance)}`;
  }

  private problem(): string {
    const amount = Number(this.amount);
    const rate = Number(this.rate);

    if (!this.personName.trim()) return 'Enter the person’s name.';
    if (this.personName.trim().length > 80) return 'Keep the name to 80 characters.';
    if (!(amount > 0) || amount > MAX || Math.round(amount * 100) !== Math.round(amount * 1e6) / 1e4) {
      return 'Enter an amount above ₹0 with at most two decimal places.';
    }
    if (!this.accountId) return this.lent ? 'Choose the account it was given from.' : 'Choose the account it was received into.';
    if (this.lent && this.available !== null && amount > this.available) {
      return `${this.account!.category} holds ₹${this.fmt(this.available)}, so no more than that can be given from it.`;
    }
    if (!this.date || this.date > this.today) return 'Choose a date that is today or earlier.';
    if (this.dueDate && this.dueDate < this.date) return 'The expected repayment date cannot be before the money changed hands.';
    if (this.withInterest && (!(rate > 0) || rate > 100 || Math.round(rate * 100) !== Math.round(rate * 1e6) / 1e4)) {
      return 'Enter an interest rate above 0% and up to 100%, with at most two decimal places.';
    }
    return '';
  }

  onSubmit(): void {
    this.error = this.problem();

    if (this.error) {
      return;
    }

    this.save.emit({
      direction: this.direction,
      personName: this.personName.trim(),
      contact: this.contact.trim() || null,
      amount: Number(this.amount),
      date: this.date,
      accountId: this.accountId,
      dueDate: this.dueDate || null,
      interest: this.withInterest ? { type: 'simple', rate: Number(this.rate), period: this.period } : { type: 'none' },
      notes: this.notes.trim() || null
    });
  }
}
