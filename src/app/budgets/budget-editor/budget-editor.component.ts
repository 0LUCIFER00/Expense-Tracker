import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { monthLabel } from '../../shared/budget.service';
import { BudgetDraft } from '../../shared/models';

/** The largest budget the API accepts for a month or a category. */
const BUDGET_MAX = 999_999_999.99;

interface Row {
  category: string;
  amount: string;
}

/**
 * Creating or changing a month's budget: an optional overall limit and limits
 * per category. Nothing is saved until Save; removing a row here only takes it
 * out of the form, and Cancel puts everything back.
 *
 * Checks what it can before sending (positive amounts, one row per category),
 * and the API checks it all again.
 */
@Component({
  selector: 'app-budget-editor',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  templateUrl: './budget-editor.component.html',
  styleUrl: './budget-editor.component.css'
})
export class BudgetEditorComponent implements OnChanges {
  @Input({ required: true }) draft!: BudgetDraft;
  @Input() categoryNames: string[] = [];
  @Input() monthName = '';
  /** "YYYY-MM" of the month the amounts were copied from, if they were. */
  @Input() copiedFrom: string | null = null;
  @Input() busy = false;

  @Output() save = new EventEmitter<BudgetDraft>();
  @Output() cancel = new EventEmitter<void>();

  total = '';
  rows: Row[] = [];
  adding = '';
  /** Shown once Save has been tried, so a half-typed form is not shouted at. */
  tried = false;

  ngOnChanges(): void {
    this.total = this.draft.total === null ? '' : String(this.draft.total);
    this.rows = this.draft.categories.map(entry => ({
      category: entry.category,
      amount: String(entry.amount)
    }));
    this.adding = '';
    this.tried = false;
  }

  get copiedName(): string {
    return this.copiedFrom ? monthLabel(this.copiedFrom) : '';
  }

  /** Categories not yet in the form: a category can only have one budget. */
  get available(): string[] {
    const used = new Set(this.rows.map(row => row.category));
    return this.categoryNames.filter(name => !used.has(name));
  }

  get allocated(): number {
    return this.rows.reduce((sum, row) => sum + (this.parse(row.amount) ?? 0), 0);
  }

  get totalValue(): number | null {
    return this.total.trim() === '' ? null : this.parse(this.total);
  }

  /** Categories adding up to more than the overall limit: worth saying, not wrong. */
  get overAllocated(): boolean {
    const total = this.totalValue;
    return total !== null && this.allocated > total;
  }

  get totalError(): string {
    return this.total.trim() !== '' && this.totalValue === null ? 'Enter an amount above ₹0.' : '';
  }

  rowError(row: Row): string {
    return this.parse(row.amount) === null ? 'Enter an amount above ₹0.' : '';
  }

  get isEmpty(): boolean {
    return this.total.trim() === '' && this.rows.length === 0;
  }

  get isValid(): boolean {
    return !this.isEmpty && !this.totalError && this.rows.every(row => !this.rowError(row));
  }

  onAdd(): void {
    if (!this.adding) {
      return;
    }

    this.rows = [...this.rows, { category: this.adding, amount: '' }];
    this.adding = '';
  }

  onRemove(row: Row): void {
    this.rows = this.rows.filter(entry => entry !== row);
  }

  onSave(): void {
    this.tried = true;

    if (!this.isValid || this.busy) {
      return;
    }

    this.save.emit({
      total: this.totalValue,
      categories: this.rows.map(row => ({ category: row.category, amount: this.parse(row.amount)! }))
    });
  }

  /** A positive amount to the paisa, or null. */
  private parse(text: string): number | null {
    const value = String(text ?? '').trim();

    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      return null;
    }

    const amount = Number(value);
    return amount > 0 && amount <= BUDGET_MAX ? amount : null;
  }
}
