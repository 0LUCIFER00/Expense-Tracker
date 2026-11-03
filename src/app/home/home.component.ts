import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BalanceAccount, Expense } from '../shared/models';
import { CategoryTotal, ExpenseService } from '../shared/expense.service';
import { BalanceService } from '../shared/balance.service';
import { SettingsService } from '../shared/settings.service';
import { WhatsappService } from '../shared/whatsapp.service';
import {
  DashboardAccount,
  DashboardCategory,
  DashboardData,
  DashboardDay
} from '../shared/dashboard';
import { parseLocalDate } from '../shared/date-utils';
import { FitsScreenDirective } from '../shared/fits-screen.directive';
import { ToastService } from '../shared/toast.service';
import { BalancesLayoutComponent } from './balances-layout/balances-layout.component';
import { SpendingLayoutComponent } from './spending-layout/spending-layout.component';

/**
 * The dashboard.
 *
 * This works out the figures; one of the two layout components draws them. The
 * arithmetic lives here rather than in either layout so a number cannot come
 * out different depending on which one you are looking at.
 *
 * Which one is drawn follows the permission, not a preference: a session that
 * may see balances gets the layout built around them, and one that may not gets
 * the layout built without them. That is the admin password's whole purpose, so
 * it is not something to leave to a setting someone could forget to turn on.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  imports: [
    CommonModule,
    FitsScreenDirective,
    BalancesLayoutComponent,
    SpendingLayoutComponent
  ]
})
export class HomeComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly whatsappService = inject(WhatsappService);
  private readonly toast = inject(ToastService);

  /** Null until the first load finishes, so neither layout renders half-made. */
  data: DashboardData | null = null;

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
        this.data = this.summarise(
          expenses,
          // Unsaved rows are drafts on the Money Management page, not accounts.
          balances.filter(account => account.saved),
          Boolean(whatsapp?.available && !whatsapp?.connected)
        );
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  private summarise(
    expenses: Expense[],
    accounts: BalanceAccount[],
    offerWhatsapp: boolean
  ): DashboardData {
    const now = new Date();

    // Rolling back a month has to carry into the previous year, otherwise
    // January looks for month -1 and always reports zero.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const thisMonth = this.forMonth(expenses, now.getMonth(), now.getFullYear());

    const spent = this.expenseService.totalOf(thisMonth);
    const days = this.toDays(expenses, now);
    const lastMonthSpent = this.expenseService.totalOf(
      this.forMonth(expenses, lastMonth.getMonth(), lastMonth.getFullYear())
    );

    return {
      today: now,
      monthName: now.toLocaleDateString(undefined, { month: 'long' }),
      lastMonthName: lastMonth.toLocaleDateString(undefined, { month: 'long' }),

      spent,
      lastMonthSpent,
      difference: Math.abs(spent - lastMonthSpent),
      spentMore: spent > lastMonthSpent,

      // Over the days gone by, not the length of the month: on the 2nd,
      // dividing by 30 would report an average nobody is actually spending.
      dailyAverage: Math.round(spent / now.getDate()),
      entries: thisMonth.length,

      accounts: this.toAccountRows(accounts),
      accountsTotal: accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0),
      canSeeBalances: this.settingsService.canSeeBalances,

      categories: this.toCategories(this.expenseService.byCategory(thisMonth)),
      recent: this.toRecent(expenses),

      days,
      busiestDay: Math.max(0, ...days.map(day => day.total)),

      projected: this.project(spent, now),
      pending: expenses.filter(expense => expense.isPendingApproval).length,

      offerWhatsapp
    };
  }

  /**
   * What the month comes to if the rate so far holds.
   *
   * Nothing before the fourth: on the second, one restaurant bill triples the
   * figure, and a projection that swings like that is worse than none.
   */
  private project(spent: number, now: Date): number | null {
    const dayOfMonth = now.getDate();

    if (dayOfMonth < 4) {
      return null;
    }

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    return Math.round((spent / dayOfMonth) * daysInMonth);
  }

  private forMonth(expenses: Expense[], month: number, year: number): Expense[] {
    return expenses.filter(expense => {
      const date = parseLocalDate(expense.date);
      return date.getMonth() === month && date.getFullYear() === year;
    });
  }

  /**
   * Largest first, each sized against the largest rather than the total, so one
   * big account does not flatten the rest into nothing. An empty account still
   * gets a visible sliver.
   */
  private toAccountRows(accounts: BalanceAccount[]): DashboardAccount[] {
    const sorted = [...accounts].sort(
      (a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0)
    );

    const largest = Number(sorted[0]?.balance ?? 0);

    return sorted.map(account => ({
      name: account.category,
      kind: account.type,
      balance: account.balance,
      share: largest
        ? Math.max(2, Math.round((Number(account.balance ?? 0) / largest) * 100))
        : 0
    }));
  }

  /**
   * The last fourteen days, one entry each, including the empty ones.
   *
   * Always fourteen: a chart with a fixed number of slots reads as a chart even
   * when most of them are zero, where a bar per expense would leave a card
   * holding a single stripe.
   */
  private toDays(expenses: Expense[], now: Date): DashboardDay[] {
    const byDay = new Map<string, number>();

    for (const expense of expenses) {
      if (expense.status !== 'Done') {
        continue;
      }

      const key = String(expense.date).slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + Number(expense.amount));
    }

    const days: DashboardDay[] = [];

    for (let back = 13; back >= 0; back -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);

      const key =
        `${date.getFullYear()}-` +
        `${String(date.getMonth() + 1).padStart(2, '0')}-` +
        `${String(date.getDate()).padStart(2, '0')}`;

      days.push({ date, total: byDay.get(key) ?? 0, height: 0, isToday: back === 0 });
    }

    const busiest = Math.max(0, ...days.map(day => day.total));

    // A day with nothing keeps a visible stub, so the axis reads continuously.
    return days.map(day => ({
      ...day,
      height: busiest ? Math.max(4, Math.round((day.total / busiest) * 100)) : 4
    }));
  }

  private toCategories(totals: CategoryTotal[]): DashboardCategory[] {
    const largest = totals[0]?.total ?? 0;

    if (!largest) {
      return [];
    }

    return totals.slice(0, 5).map((entry, index) => ({
      name: entry.category,
      total: entry.total,
      share: Math.max(2, Math.round((entry.total / largest) * 100)),
      tone: index
    }));
  }

  /**
   * By the date spent, not the date entered: a panel that shows dates and then
   * lists 12 Oct above 2 Nov reads as a bug. Two on the same day fall back to
   * the order they were added.
   *
   * Twelve rather than five: each layout draws as many as its card has room
   * for, and a tall window has room for more than a short one.
   */
  private toRecent(expenses: Expense[]): Expense[] {
    return [...expenses]
      .sort((a, b) => {
        const byDate =
          parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime();

        return byDate !== 0
          ? byDate
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 12);
  }
}
