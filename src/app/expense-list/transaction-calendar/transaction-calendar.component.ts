import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import type { TransactionRow } from '../expense-list.component';
import { FilteredTotals, totalsOf } from '../transaction-filters';
import { personalAmount } from '../../shared/expense.service';
import {
  CalendarCell,
  DaySummary,
  MonthKey,
  highSpendDays,
  monthGrid,
  monthOf,
  summariseDays
} from './calendar-month';

interface DayCell extends CalendarCell {
  summary: DaySummary | null;
  today: boolean;
  future: boolean;
  high: boolean;
  label: string;
}

const NONE: FilteredTotals = { expensePaise: 0, incomePaise: 0, repaidPaise: 0, netPaise: 0 };

/**
 * The month as a calendar: a summary, one cell per day with what went out and
 * came in, and the chosen day's entries beside it. Only a view: it reads the
 * rows it is given and opens the existing details drawer through `open`; it
 * never changes an entry, a balance or a budget.
 */
@Component({
  selector: 'app-transaction-calendar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transaction-calendar.component.html',
  styleUrls: ['./transaction-calendar.component.css', './calendar-day.css']
})
export class TransactionCalendarComponent implements OnChanges {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The list's rows after its search, filters and tab (any date). */
  @Input() rows: TransactionRow[] = [];
  @Input() month: MonthKey = '';
  /** YYYY-MM-DD, India's today. */
  @Input() today = '';
  @Input() canViewSource = true;
  @Input() loading = false;

  /** Opens an entry in the details drawer the list uses. */
  @Output() open = new EventEmitter<TransactionRow>();

  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  cells: DayCell[] = [];
  monthTotals: FilteredTotals = NONE;
  monthCount = 0;
  averagePaise = 0;
  selected: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['month'] || !this.cells.length) {
      // A new month opens on today when today is in it, else on nothing.
      this.selected = monthOf(this.today) === this.month ? this.today : null;
    }

    this.build();
  }

  private build(): void {
    const days = summariseDays(this.rows, this.month);
    const high = highSpendDays(days);
    const inMonth = [...days.values()].flatMap(day => day.rows);

    this.monthTotals = totalsOf(inMonth);
    this.monthCount = inMonth.length;
    this.averagePaise = high.averagePaise;

    this.cells = monthGrid(this.month).map(cell => {
      const summary = cell.inMonth ? days.get(cell.iso) ?? null : null;
      const isHigh = high.days.has(cell.iso);

      return {
        ...cell,
        summary,
        today: cell.iso === this.today,
        future: cell.iso > this.today,
        high: isHigh,
        label: this.cellLabel(cell, summary, isHigh)
      };
    });
  }

  private cellLabel(cell: CalendarCell, summary: DaySummary | null, high: boolean): string {
    const date = this.longDate(cell.iso);

    if (!cell.inMonth) return date;
    if (!summary) return `${date}, nothing recorded`;

    const parts = [`${date}`, `${summary.rows.length} ${summary.rows.length === 1 ? 'entry' : 'entries'}`];
    if (summary.totals.expensePaise) parts.push(`spent ${this.rupees(summary.totals.expensePaise)}`);
    if (summary.totals.incomePaise) parts.push(`income ${this.rupees(summary.totals.incomePaise)}`);
    if (high) parts.push('high spending day');

    return parts.join(', ');
  }

  /** The average spending day, to the rupee, for the High explanation. */
  get averageLabel(): string {
    return this.rupees(Math.round(this.averagePaise / 100) * 100);
  }

  get selectedSummary(): DaySummary | null {
    return this.cells.find(cell => cell.iso === this.selected)?.summary ?? null;
  }

  get selectedHigh(): boolean {
    return !!this.cells.find(cell => cell.iso === this.selected)?.high;
  }

  /** The chosen day's entries, newest first as the list shows them. */
  get selectedRows(): TransactionRow[] {
    return [...(this.selectedSummary?.rows ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  pick(cell: DayCell): void {
    if (cell.inMonth) {
      this.selected = cell.iso;
    }
  }

  /** Arrow keys move the chosen day (and focus) through the month. */
  onGridKey(event: KeyboardEvent, cell: DayCell): void {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];

    if (step === undefined) return;

    const index = this.cells.indexOf(cell) + step;
    const target = this.cells[index];

    if (!target?.inMonth) return;

    event.preventDefault();
    this.selected = target.iso;
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-iso="${target.iso}"]`)?.focus());
  }

  // ------------------------------------------------------------ display

  rupees(paise: number): string {
    const digits = paise % 100 === 0 ? 0 : 2;

    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  /** ₹1,450 → ₹1.4k, for the small cells on a phone. */
  short(paise: number): string {
    const rupees = paise / 100;

    if (rupees >= 100000) return `${(rupees / 100000).toFixed(1).replace(/\.0$/, '')}L`;
    if (rupees >= 1000) return `${(rupees / 1000).toFixed(rupees >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;

    return String(Math.round(rupees));
  }

  longDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);

    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /** What a row adds to the day, signed, the way the list reads it. */
  rowAmount(row: TransactionRow): string {
    const paise = Math.round(Number(row.amount) * 100);

    return `${row.kind === 'in' ? '+' : '−'}${this.rupees(paise)}`;
  }

  /** Expense, Income, Repayment, plus Pending or your share of a split. */
  rowKind(row: TransactionRow): string {
    if (row.income) {
      return row.income.splitExpenseId ? 'Repayment, not income' : 'Income';
    }

    const expense = row.expense!;
    const parts = ['Expense'];

    if (expense.isPendingApproval) parts.push('pending approval');
    if (expense.splitMembers) parts.push(`split ${expense.splitMembers}, yours ${this.rupees(Math.round(personalAmount(expense) * 100))}`);

    return parts.join(' · ');
  }
}
