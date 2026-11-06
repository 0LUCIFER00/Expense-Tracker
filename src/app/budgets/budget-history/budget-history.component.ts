import { DecimalPipe } from '@angular/common';
import { Component, Input, OnChanges, inject } from '@angular/core';
import { BudgetService, monthLabel } from '../../shared/budget.service';
import { BudgetHistory } from '../../shared/models';

/**
 * Several months side by side, ending with the one being looked at: budget
 * against what was spent, the overspend, the change from the month before, and
 * the categories that keep going over.
 *
 * Worked out by the API from the expenses every time, so editing an old
 * expense corrects its month here as well.
 */
@Component({
  selector: 'app-budget-history',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './budget-history.component.html',
  styleUrl: './budget-history.component.css'
})
export class BudgetHistoryComponent implements OnChanges {
  private readonly budgetService = inject(BudgetService);

  @Input({ required: true }) monthKey!: string;

  readonly spans = [3, 6, 12];
  months = 6;

  history: BudgetHistory | null = null;
  loading = true;
  error = '';

  ngOnChanges(): void {
    this.load();
  }

  onSpan(months: number): void {
    if (months !== this.months) {
      this.months = months;
      this.load();
    }
  }

  label(key: string): string {
    return monthLabel(key, true);
  }

  fullLabel(key: string): string {
    return monthLabel(key);
  }

  width(percent: number | null): number {
    return Math.min(100, Math.max(0, percent ?? 0));
  }

  /** Bar width for a month with no budget: relative to the busiest such month. */
  plainWidth(spent: number): number {
    const most = Math.max(...(this.history?.months ?? []).map(month => month.spent), 1);
    return Math.round((spent / most) * 100);
  }

  load(): void {
    const key = this.monthKey;
    const months = this.months;

    this.loading = true;
    this.error = '';

    this.budgetService.history(key, months).subscribe({
      next: history => {
        if (key === this.monthKey && months === this.months) {
          this.history = history;
          this.loading = false;
        }
      },
      error: error => {
        if (key === this.monthKey && months === this.months) {
          this.loading = false;
          this.error = error.message;
        }
      }
    });
  }
}
