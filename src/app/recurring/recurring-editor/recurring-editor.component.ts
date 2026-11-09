import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BalanceAccount,
  RecurringDraft,
  RecurringFrequency,
  RecurringKind,
  RecurringRun,
  RecurringSchedule
} from '../../shared/models';
import { REMIND_OPTIONS, dateLabel, previewDates } from '../../shared/recurring.service';

/** What the Repeats list offers; "custom" opens "every N days/weeks/months/years". */
type RepeatChoice = RecurringFrequency | 'custom';

/** What the editor hands back: the draft, and for an edit whether it should be active. */
export interface RecurringSave {
  draft: RecurringDraft;
  active: boolean;
}

const AMOUNT_MAX = 100_000;

/**
 * The New / Edit recurring form, shown in a panel over the page.
 *
 * It only collects and checks what was typed; the page saves it, and the
 * server checks everything again.
 */
@Component({
  selector: 'app-recurring-editor',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './recurring-editor.component.html',
  styleUrl: './recurring-editor.component.css'
})
export class RecurringEditorComponent implements OnInit {
  /** Null for a new schedule. */
  @Input() schedule: RecurringSchedule | null = null;
  @Input() today = '';
  @Input() accounts: BalanceAccount[] = [];
  @Input() expenseCategories: string[] = [];
  @Input() incomeCategories: string[] = [];
  @Input() history: RecurringRun[] = [];
  @Input() busy = false;
  /** May an expense take money from an account (and income go into one). */
  @Input() canUseAccounts = true;
  @Input() canAddIncome = true;
  /** May the first date be in the past. */
  @Input() canBackdate = false;

  @Output() save = new EventEmitter<RecurringSave>();
  @Output() cancel = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();

  kind: RecurringKind = 'expense';
  description = '';
  amount: number | null = null;
  category = '';
  accountId = '';
  repeat: RepeatChoice = 'monthly';
  customEvery = 2;
  customUnit: RecurringFrequency = 'weekly';
  firstDate = '';
  endsOn = false;
  endOn = '';
  remindDays = '1';
  active = true;

  error = '';

  readonly remindOptions = REMIND_OPTIONS.map(option => ({
    value: option.value === null ? '' : String(option.value),
    label: option.label
  }));

  readonly dateLabel = dateLabel;

  get editing(): boolean {
    return this.schedule !== null;
  }

  get categories(): string[] {
    return this.kind === 'income' ? this.incomeCategories : this.expenseCategories;
  }

  get savedAccounts(): BalanceAccount[] {
    return this.accounts.filter(account => account.saved);
  }

  get frequency(): RecurringFrequency {
    return this.repeat === 'custom' ? this.customUnit : this.repeat;
  }

  get interval(): number {
    return this.repeat === 'custom' ? Math.trunc(Number(this.customEvery)) : 1;
  }

  /** The next few dates, so a schedule on the 31st shows what happens in February. */
  get preview(): string[] {
    if (!this.firstDate || !(this.interval >= 1 && this.interval <= 99)) {
      return [];
    }

    return previewDates(this.frequency, this.interval, this.firstDate, this.endsOn ? this.endOn || null : null);
  }

  /** Dates in the preview that are not on the chosen day of the month. */
  isShortMonth(date: string): boolean {
    return (this.frequency === 'monthly' || this.frequency === 'yearly') &&
      date.slice(8) !== this.firstDate.slice(8);
  }

  get monthEndNote(): boolean {
    return this.preview.some(date => this.isShortMonth(date));
  }

  ngOnInit(): void {
    const s = this.schedule;

    if (!s) {
      this.firstDate = this.today;
      this.kind = this.canUseAccounts || !this.canAddIncome ? 'expense' : 'income';
      this.accountId = this.canUseAccounts ? (this.savedAccounts[0]?.id ?? '') : '';
      return;
    }

    this.kind = s.kind;
    this.description = s.description;
    this.amount = s.amount;
    this.category = s.category ?? '';
    this.accountId = s.accountId ?? '';
    this.repeat = s.interval > 1 ? 'custom' : s.frequency;
    this.customEvery = s.interval > 1 ? s.interval : 2;
    this.customUnit = s.frequency;
    this.firstDate = s.nextDueOn ?? this.today;
    this.endsOn = s.endOn !== null;
    this.endOn = s.endOn ?? '';
    this.remindDays = s.remindDays === null ? '' : String(s.remindDays);
    this.active = s.status !== 'paused';
  }

  setKind(kind: RecurringKind): void {
    if (this.editing || kind === this.kind) {
      return;
    }

    this.kind = kind;
    this.category = '';

    if (kind === 'income' && !this.accountId) {
      this.accountId = this.savedAccounts[0]?.id ?? '';
    }
  }

  onSubmit(): void {
    this.error = this.check();

    if (this.error) {
      return;
    }

    const draft: RecurringDraft = {
      kind: this.kind,
      description: this.description.trim(),
      amount: Number(this.amount),
      category: this.category || null,
      accountId: this.accountId || null,
      frequency: this.frequency,
      interval: this.interval,
      endOn: this.endsOn ? this.endOn : null,
      remindDays: this.remindDays === '' ? null : Number(this.remindDays)
    };

    if (this.editing) {
      draft.nextDueOn = this.firstDate;
    } else {
      draft.startOn = this.firstDate;
    }

    this.save.emit({ draft, active: this.active });
  }

  private check(): string {
    const amount = Number(this.amount);

    if (!this.description.trim()) return 'Enter a description.';
    if (!(amount > 0) || amount > AMOUNT_MAX) return 'Enter an amount above ₹0 and no more than ₹1,00,000.';
    if (this.kind === 'income' && !this.accountId) return 'Choose the account the money goes into.';
    if (!this.firstDate) return this.editing ? 'Choose the next date.' : 'Choose a start date.';
    if (!this.canBackdate && this.firstDate < this.today && this.firstDate !== this.schedule?.nextDueOn) {
      return 'Start today or later.';
    }
    if (this.repeat === 'custom' && !(this.interval >= 1 && this.interval <= 99)) return 'Repeat every 1 to 99.';
    if (this.endsOn && (!this.endOn || this.endOn < this.firstDate)) {
      return 'The end date must be on or after the first date.';
    }

    return '';
  }
}
