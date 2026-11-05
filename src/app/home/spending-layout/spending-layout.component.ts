import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DashboardData } from '../../shared/dashboard';
import { Expense } from '../../shared/models';
import { SpendChartComponent } from '../../shared/spend-chart/spend-chart.component';
import { SplitHistoryComponent } from '../../shared/split-history/split-history.component';

/**
 * The dashboard for a session whose balances are hidden.
 *
 * That is the full-access password's whole purpose: signing in as a normal user in
 * public should put no account balance on screen. So this draws the same month
 * without any of it — no account tiles, no total held, no figure after an
 * expense — and spends the room on what was spent instead, which is not the
 * secret.
 *
 * It also says plainly that balances are hidden and how to see them. Without
 * that the page just looks like a feature that is missing.
 */
@Component({
  selector: 'app-spending-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SpendChartComponent, SplitHistoryComponent],
  templateUrl: './spending-layout.component.html',
  styleUrl: './spending-layout.component.css'
})
export class SpendingLayoutComponent {
  @Input({ required: true }) data!: DashboardData;

  /** The split row in Recent whose repayment history is open; one at a time. */
  expandedId: string | null = null;

  onToggleSplit(item: Expense): void {
    if (!item.splitMembers) {
      return;
    }

    this.expandedId = this.expandedId === item.id ? null : item.id;
  }

  /** The busiest single day this fortnight, which the chart is scaled against. */
  get busiestDay(): number {
    return this.data.busiestDay;
  }

  /**
   * Each category's width as a percentage of the month.
   *
   * The bar divides the total, unlike a list that scales against the largest —
   * a stacked bar only reads correctly if the parts sum to 100.
   */
  get slices(): { name: string; total: number; width: number; tone: number }[] {
    const total = this.data.categories.reduce((sum, c) => sum + c.total, 0);

    if (!total) {
      return [];
    }

    return this.data.categories.map(category => ({
      name: category.name,
      total: category.total,
      width: (category.total / total) * 100,
      tone: category.tone
    }));
  }
}
