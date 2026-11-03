import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DashboardData } from '../../shared/dashboard';
import { Expense } from '../../shared/models';

/**
 * Layout C — the ledger.
 *
 * The accounts become a full-height rail, which is the shape that list wants
 * and needs no box around it. The expenses become a real table: ruled rows read
 * as a ledger with room left in it, where an empty card just reads as broken.
 * Categories turn into filter chips rather than a panel of their own.
 */
@Component({
  selector: 'app-ledger-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './ledger-layout.component.html',
  styleUrl: './ledger-layout.component.css'
})
export class LedgerLayoutComponent {
  @Input({ required: true }) data!: DashboardData;

  /** Narrows the table to one category; empty is "All". */
  selected = '';

  get rows(): Expense[] {
    if (!this.selected) {
      return this.data.recent;
    }

    return this.data.recent.filter(expense => expense.category === this.selected);
  }

  get shownTotal(): number {
    return this.rows
      .filter(expense => !expense.isPendingApproval)
      .reduce((sum, expense) => sum + Number(expense.amount), 0);
  }

  onPick(category: string): void {
    this.selected = this.selected === category ? '' : category;
  }
}
