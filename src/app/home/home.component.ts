import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BalanceAccount, Expense } from '../shared/models';
import { CategoryTotal, ExpenseService } from '../shared/expense.service';
import { BalanceService } from '../shared/balance.service';
import { SettingsService } from '../shared/settings.service';
import { WhatsappService, WhatsappLinkStatus } from '../shared/whatsapp.service';
import { parseLocalDate } from '../shared/date-utils';
import { FitsScreenDirective } from '../shared/fits-screen.directive';

/** A row in "Where your money is": the account plus its share of the largest. */
interface AccountRow {
  account: BalanceAccount;
  share: number;
}

/** A row in "Where it went": the category, its share, and its ramp colour. */
interface CategoryBar extends CategoryTotal {
  share: number;
  tone: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  imports: [CommonModule, RouterModule, FitsScreenDirective]
})
export class HomeComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly whatsappService = inject(WhatsappService);

  today = new Date();
  expenses: Expense[] = [];

  /** The headline figure: what has been spent in the month being shown. */
  currentMonthSpent = 0;
  lastMonthSpent = 0;

  /** This month minus last, as a positive number; `spentMore` carries the sign. */
  monthDifference = 0;
  spentMore = false;

  /** Spend so far this month over the days elapsed, not the whole month. */
  dailyAverage = 0;
  monthEntries = 0;

  categoryBars: CategoryBar[] = [];
  recent: Expense[] = [];

  accountRows: AccountRow[] = [];
  accountsTotal = 0;
  canSeeBalances = false;

  whatsapp: WhatsappLinkStatus | null = null;

  loadError = '';

  /** "November", for the figure's caption. */
  get monthName(): string {
    return this.today.toLocaleDateString(undefined, { month: 'long' });
  }

  get lastMonthName(): string {
    const date = new Date(this.today.getFullYear(), this.today.getMonth() - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long' });
  }

  ngOnInit(): void {
    forkJoin({
      expenses: this.expenseService.list(),
      balances: this.balanceService.list(),
      settings: this.settingsService.load(true),
      // The dashboard is still worth showing if this one fails, so it resolves
      // to null rather than taking the whole page down.
      whatsapp: this.whatsappService.status().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ expenses, balances, whatsapp }) => {
        this.expenses = expenses;
        this.whatsapp = whatsapp;
        this.canSeeBalances = this.settingsService.canSeeBalances;

        // Unsaved rows are drafts on the Balance Management page, not accounts.
        this.summariseAccounts(balances.filter(account => account.saved));
        this.summarise();
      },
      error: error => {
        this.loadError = error.message;
      }
    });
  }

  private summariseAccounts(accounts: BalanceAccount[]): void {
    this.accountsTotal = accounts.reduce(
      (sum, account) => sum + Number(account.balance ?? 0),
      0
    );

    const sorted = [...accounts].sort(
      (a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0)
    );

    const largest = Number(sorted[0]?.balance ?? 0);

    this.accountRows = sorted.map(account => ({
      account,
      // Against the largest account, so one big balance does not flatten the rest
      // into nothing. An empty account still gets a visible sliver.
      share: largest ? Math.max(2, Math.round((Number(account.balance ?? 0) / largest) * 100)) : 0
    }));
  }

  private summarise(): void {
    const now = new Date();

    // Rolling back a month has to carry into the previous year, otherwise
    // January looks for month -1 and always reports zero.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const thisMonthExpenses = this.forMonth(now.getMonth(), now.getFullYear());

    this.currentMonthSpent = this.expenseService.totalOf(thisMonthExpenses);
    this.lastMonthSpent = this.expenseService.totalOf(
      this.forMonth(lastMonth.getMonth(), lastMonth.getFullYear())
    );

    this.monthDifference = Math.abs(this.currentMonthSpent - this.lastMonthSpent);
    this.spentMore = this.currentMonthSpent > this.lastMonthSpent;

    this.monthEntries = thisMonthExpenses.length;

    // Over the days gone by, not the length of the month: on the 2nd, dividing
    // by 30 would report an average nobody is actually spending.
    this.dailyAverage = Math.round(this.currentMonthSpent / now.getDate());

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
   *
   * `tone` steps a colour ramp down the list, which the stylesheet turns into
   * the actual shade — so light and dark each pick their own.
   */
  private toBars(totals: CategoryTotal[]): CategoryBar[] {
    const largest = totals[0]?.total ?? 0;

    if (!largest) {
      return [];
    }

    return totals.slice(0, 5).map((entry, index) => ({
      ...entry,
      share: Math.max(2, Math.round((entry.total / largest) * 100)),
      tone: index
    }));
  }
}
