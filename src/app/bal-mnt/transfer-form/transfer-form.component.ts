import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BalanceService } from '../../shared/balance.service';
import { BalanceAccount, TransferResult } from '../../shared/models';
import { today } from '../../shared/date-utils';
import { ToastService } from '../../shared/toast.service';

const MAX = 99_99_99_999.99;

/** A fresh id per submission; a retry of the same one is processed once by the server. */
function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/**
 * Transfer Money: move an amount from one of your accounts to another. The
 * server debits one and credits the other together, and refuses a transfer
 * the source cannot cover; this form only checks what was typed.
 */
@Component({
  selector: 'app-transfer-form',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './transfer-form.component.html',
  styleUrl: './transfer-form.component.css'
})
export class TransferFormComponent implements OnInit {
  private readonly balances = inject(BalanceService);
  private readonly toast = inject(ToastService);

  /** Saved accounts, with their balances. */
  @Input() accounts: BalanceAccount[] = [];
  /** May the date be earlier than today ("Change transaction dates"). */
  @Input() canBackdate = false;

  @Output() transferred = new EventEmitter<TransferResult>();

  fromId = '';
  toId = '';
  amount: number | null = null;
  date = today();
  description = '';

  busy = false;
  error = '';
  success = '';

  readonly today = today();
  private requestId = newRequestId();

  get from(): BalanceAccount | undefined {
    return this.accounts.find(a => a.id === this.fromId);
  }

  get to(): BalanceAccount | undefined {
    return this.accounts.find(a => a.id === this.toId);
  }

  /** The destinations offered: every account but the source. */
  get destinations(): BalanceAccount[] {
    return this.accounts.filter(a => a.id !== this.fromId);
  }

  ngOnInit(): void {
    this.fromId = this.accounts[0]?.id ?? '';
    this.toId = this.accounts[1]?.id ?? '';
  }

  onFromChange(): void {
    if (this.toId === this.fromId) {
      this.toId = this.destinations[0]?.id ?? '';
    }

    this.clearMessages();
  }

  /** Swaps source and destination. */
  swap(): void {
    [this.fromId, this.toId] = [this.toId, this.fromId];
    this.clearMessages();
  }

  /** The whole balance of the source, as a quick fill. */
  useAll(): void {
    if (this.from?.balance) {
      this.amount = this.from.balance;
    }
  }

  clearMessages(): void {
    this.error = '';
    this.success = '';
  }

  onSubmit(): void {
    this.success = '';
    this.error = this.check();

    if (this.error) {
      return;
    }

    const from = this.from!;
    const to = this.to!;
    const amount = Number(this.amount);
    this.busy = true;

    this.balances.transfer({
      fromAccountId: from.id,
      toAccountId: to.id,
      amount,
      date: this.date,
      description: this.description.trim() || null,
      requestId: this.requestId,
      tzOffset: new Date().getTimezoneOffset()
    }).subscribe({
      next: result => {
        this.busy = false;
        const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

        this.success = result.duplicate
          ? 'That transfer had already gone through; nothing was moved twice.'
          : `Moved ₹${fmt(amount)} from ${from.category} to ${to.category}. ` +
            `${from.category} now ₹${fmt(result.fromBalance)}, ${to.category} now ₹${fmt(result.toBalance)}.`;
        this.toast.success(this.success);

        // Ready for the next one.
        this.requestId = newRequestId();
        this.amount = null;
        this.description = '';
        this.transferred.emit(result);
      },
      error: error => {
        this.busy = false;
        this.error = error.message;
        // A refusal is final for this request; a network failure keeps the
        // same id, so trying again cannot move the money twice.
        if (error.status && error.status < 500) {
          this.requestId = newRequestId();
        }
      }
    });
  }

  private check(): string {
    const amount = Number(this.amount);

    if (!this.from || !this.to) return 'Choose both accounts.';
    if (this.fromId === this.toId) return 'Choose two different accounts.';
    if (!(amount > 0) || amount > MAX || Math.round(amount * 100) !== amount * 100) {
      return 'Enter an amount above ₹0 with at most two decimal places.';
    }
    if (this.from.balance !== null && amount > this.from.balance) {
      return `Not enough in ${this.from.category}: it holds ₹${this.from.balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}.`;
    }
    if (!this.date || this.date > this.today) return 'A transfer cannot be dated in the future.';
    if (this.date !== this.today && !this.canBackdate) {
      return 'Earlier dates need "Change transaction dates", or your full-access password.';
    }

    return '';
  }
}
