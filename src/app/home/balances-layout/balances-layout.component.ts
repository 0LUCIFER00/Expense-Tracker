import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DashboardData } from '../../shared/dashboard';
import { SpendChartComponent } from '../../shared/spend-chart/spend-chart.component';

/**
 * Layout A — balances first.
 *
 * The accounts are the only list that is always populated, so they run across
 * the top as tiles and anchor the page. Spending gets the wide card below, with
 * the stats pinned to its foot so it reads full however little sits above them.
 * Categories are one stacked bar rather than a list: one category fills it, six
 * divide it, and neither looks like a mistake.
 */
@Component({
  selector: 'app-balances-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SpendChartComponent],
  templateUrl: './balances-layout.component.html',
  styleUrl: './balances-layout.component.css'
})
export class BalancesLayoutComponent {
  @Input({ required: true }) data!: DashboardData;

  /**
   * Each category's width in the stacked bar, as a percentage of the month.
   *
   * The bar divides the total, unlike the list elsewhere which scales against
   * the largest — a stacked bar only reads correctly if the parts sum to 100.
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
