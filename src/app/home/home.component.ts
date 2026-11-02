import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BalanceAccount, Expense } from '../shared/models';
import { CategoryTotal, ExpenseService } from '../shared/expense.service';
import { BalanceService } from '../shared/balance.service';
import { SettingsService } from '../shared/settings.service';
import { AuthService } from '../auth.service';
import { parseLocalDate } from '../shared/date-utils';

/** A category bar on the dashboard: its total, and its share of the month. */
interface CategoryBar extends CategoryTotal {
  share: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css', './home.component.dark.css'],
  imports: [CommonModule, RouterModule]
})
export class HomeComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly auth = inject(AuthService);

  today = new Date();
  expenses: Expense[] = [];

  totalSpent = 0;
  currentMonthSpent = 0;
  lastMonthSpent = 0;
  totalExpenses = 0;
  pendingCount = 0;

  /** This month against last, as a percentage; null when there is nothing to compare. */
  monthChange: number | null = null;

  /** This month's spending split by category, largest first. */
  categoryBars: CategoryBar[] = [];

  /** The five most recent entries, newest first. */
  recent: Expense[] = [];

  accounts: BalanceAccount[] = [];
  accountsTotal = 0;
  canSeeBalances = false;

  loading = true;
  loadError = '';

  get firstName(): string {
    const name = this.auth.session?.user.name?.trim() ?? '';
    return name ? name.split(/\s+/)[0] : '';
  }

  ngOnInit(): void {
    forkJoin({
      expenses: this.expenseService.list(),
      balances: this.balanceService.list(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ expenses, balances }) => {
        this.expenses = expenses;
        this.canSeeBalances = this.settingsService.canSeeBalances;

        // Unsaved rows are drafts on the Balance Management page, not accounts.
        this.accounts = balances.filter(account => account.saved);

        this.accountsTotal = this.accounts.reduce(
          (sum, account) => sum + Number(account.balance ?? 0),
          0
        );

        this.summarise();
        this.loading = false;
      },
      error: error => {
        this.loadError = error.message;
        this.loading = false;
      }
    });
  }

  private summarise(): void {
    this.totalSpent = this.expenseService.totalOf(this.expenses);
    this.totalExpenses = this.expenses.length;
    this.pendingCount = this.expenses.filter(e => e.isPendingApproval).length;

    const now = new Date();

    // Rolling back a month has to carry into the previous year, otherwise
    // January looks for month -1 and always reports zero.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const thisMonthExpenses = this.forMonth(now.getMonth(), now.getFullYear());

    this.currentMonthSpent = this.expenseService.totalOf(thisMonthExpenses);
    this.lastMonthSpent = this.expenseService.totalOf(
      this.forMonth(lastMonth.getMonth(), lastMonth.getFullYear())
    );

    // A month with no previous figure has nothing to be a percentage of.
    this.monthChange = this.lastMonthSpent
      ? Math.round(
          ((this.currentMonthSpent - this.lastMonthSpent) / this.lastMonthSpent) * 100
        )
      : null;

    this.categoryBars = this.toBars(this.expenseService.byCategory(thisMonthExpenses));

    // By the date spent, not the date entered: a panel that shows dates and
    // then lists 12 Oct above 2 Nov reads as a bug.
    this.recent = [...this.expenses]
      .sort((a, b) => {
        const byDate =
          parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime();

        return byDate !== 0
          ? byDate
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 5);
  }

  private forMonth(month: number, year: number): Expense[] {
    return this.expenses.filter(expense => {
      const date = parseLocalDate(expense.date);
      return date.getMonth() === month && date.getFullYear() === year;
    });
  }

  /**
   * Bars are sized against the biggest category rather than the month's total,
   * so the shape of the spending is still readable when one category dominates.
   */
  private toBars(totals: CategoryTotal[]): CategoryBar[] {
    const largest = totals[0]?.total ?? 0;

    if (!largest) {
      return [];
    }

    return totals
      .slice(0, 6)
      .map(entry => ({ ...entry, share: Math.round((entry.total / largest) * 100) }));
  }
}
