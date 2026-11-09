import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SavingsGoal } from '../../shared/models';

export type EntryKind = 'contribution' | 'withdrawal';

export interface EntrySave {
  kind: EntryKind;
  amount: number;
  date: string;
  note: string | null;
}

const ENTRY_MAX = 1_00_00_000;

/**
 * Add money to a goal, or take some back. Only the goal's own total changes:
 * no account, budget or transaction is touched. The preview is a guide; the
 * server works out the real figures and refuses a withdrawal past the total.
 */
@Component({
  selector: 'app-goal-entry',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './goal-entry.component.html',
  styleUrl: './goal-entry.component.css'
})
export class GoalEntryComponent implements OnInit {
  @Input({ required: true }) goal!: SavingsGoal;
  @Input() today = '';
  @Input() busy = false;
  @Input() kind: EntryKind = 'contribution';

  @Output() save = new EventEmitter<EntrySave>();
  @Output() cancel = new EventEmitter<void>();

  amount: number | null = null;
  date = '';
  note = '';
  error = '';

  get adding(): boolean {
    return this.kind === 'contribution';
  }

  /** Quick amounts: this month's share and everything left, or the whole total. */
  get quick(): { label: string; amount: number }[] {
    if (!this.adding) {
      return this.goal.saved > 0 ? [{ label: `₹${this.fmt(this.goal.saved)} (everything)`, amount: this.goal.saved }] : [];
    }

    const options: { label: string; amount: number }[] = [];

    if (this.goal.monthly) {
      options.push({ label: `₹${this.fmt(this.goal.monthly)} (this month’s share)`, amount: this.goal.monthly });
    }

    if (this.goal.remaining > 0 && this.goal.remaining !== this.goal.monthly && this.goal.remaining <= ENTRY_MAX) {
      options.push({ label: `₹${this.fmt(this.goal.remaining)} (all that’s left)`, amount: this.goal.remaining });
    }

    return options;
  }

  /** The total after this entry, in paise arithmetic so it never drifts. */
  get after(): number | null {
    const amount = Number(this.amount);

    if (!(amount > 0)) {
      return null;
    }

    const paise = Math.round(this.goal.saved * 100) + (this.adding ? 1 : -1) * Math.round(amount * 100);
    return paise / 100;
  }

  get afterPercent(): number {
    return Math.floor(((this.after ?? 0) * 100) / this.goal.target);
  }

  ngOnInit(): void {
    this.date = this.today;
  }

  setKind(kind: EntryKind): void {
    this.kind = kind;
    this.amount = null;
    this.error = '';
  }

  fmt(value: number): string {
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  onSubmit(): void {
    const amount = Number(this.amount);

    if (!(amount > 0) || amount > ENTRY_MAX || Math.round(amount * 100) !== amount * 100) {
      this.error = 'Enter an amount above ₹0 with at most two decimal places, up to ₹1,00,00,000.';
    } else if (!this.adding && amount > this.goal.saved) {
      this.error = `Only ₹${this.fmt(this.goal.saved)} is saved in this goal.`;
    } else if (!this.date || this.date > this.today) {
      this.error = 'Choose a date that is today or earlier.';
    } else {
      this.error = '';
      this.save.emit({ kind: this.kind, amount, date: this.date, note: this.note.trim() || null });
    }
  }
}
