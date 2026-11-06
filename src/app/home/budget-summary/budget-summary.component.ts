import { DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BudgetLine, BudgetMonth } from '../../shared/models';
import { daysLeft, monthLabel } from '../../shared/budget.service';

/**
 * The Budget card on Home: this month against its budget, and the three
 * categories closest to (or past) their limit. Every figure comes from the API.
 *
 * Its own component and stylesheet, so Home's two layouts each place it with
 * one line and neither layout's styles grow.
 */
@Component({
  selector: 'app-budget-summary',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './budget-summary.component.html',
  styleUrl: './budget-summary.component.css'
})
export class BudgetSummaryComponent {
  @Input({ required: true }) budget!: BudgetMonth;

  get monthName(): string {
    return monthLabel(this.budget.month).split(' ')[0];
  }

  /** The three budgeted categories with the most used; the API sorts them so. */
  get top(): BudgetLine[] {
    return this.budget.categories.slice(0, 3);
  }

  get daysToGo(): number {
    return daysLeft(this.budget.month);
  }

  /** Strictly over, as opposed to exactly at the limit. */
  get isOver(): boolean {
    return this.budget.remaining !== null && this.budget.remaining < 0;
  }

  /** How full the bar is drawn; the percentage itself can pass 100. */
  width(percent: number | null): number {
    return Math.min(100, Math.max(0, percent ?? 0));
  }
}
