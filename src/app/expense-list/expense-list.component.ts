import { CommonModule } from '@angular/common';
import { TransactionDetailsComponent } from './transaction-details/transaction-details.component';
import { TransactionImportComponent } from './transaction-import/transaction-import.component';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Expense, Income, SplitSummary } from '../shared/models';
import { ExpenseService, UNCATEGORISED } from '../shared/expense.service';
import { IncomeService } from '../shared/income.service';
import { downloadCsv } from '../shared/csv';
import { ToastService } from '../shared/toast.service';
import { SettingsService } from '../shared/settings.service';
import { parseLocalDate } from '../shared/date-utils';
import { FitsScreenDirective } from '../shared/fits-screen.directive';

/** Which half of the ledger is on screen. */
export type TransactionTab = 'all' | 'out' | 'in';

/** How a repayment is labelled where an income would show its source. */
export const REPAYMENT = 'Repayment';

/**
 * One line of the ledger: an expense or money in, in a shape the table can
 * sort, filter and draw without caring which it is.
 */
export interface TransactionRow {
  /** Unique across both kinds, since an expense and an income may share an id. */
  key: string;
  kind: 'out' | 'in';
  date: string;
  amount: number;
  description: string;
  /** The expense category, or where money in came from. */
  category: string;
  /** The account it left or arrived in; null when this session may not see it. */
  account: string | null;
  /** Sorts and reads as "Done", "Waiting" or "In". */
  status: string;
  createdAt: string;
  expense?: Expense;
  income?: Income;
}

type SortColumn = 'date' | 'amount' | 'description' | 'category' | 'account' | 'status';

const TABS: TransactionTab[] = ['all', 'out', 'in'];

/**
 * Transactions — what used to be View Expenses, now with money in beside it.
 *
 * One page rather than a second list for money in: the filters, sorting,
 * export and expanding rows all apply to both, and a repayment reads best in
 * date order next to the split it pays back. The Money out tab is the old page
 * exactly, so nothing anyone relied on there has moved.
 */
@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, FormsModule, FitsScreenDirective, TransactionDetailsComponent, TransactionImportComponent],
  templateUrl: './expense-list.component.html',
  styleUrls: ['./expense-list.component.css', './transaction-panel.css']
})
export class ExpenseListComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);
  private readonly incomeService = inject(IncomeService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);
  // Optional so the component still builds where no router is provided.
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  readonly tabs: { value: TransactionTab; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'out', label: 'Debit' },
    { value: 'in', label: 'Credit' }
  ];

  tab: TransactionTab = 'all';

  /** Everything the server returned; the lists below are filtered views of it. */
  private allExpenses: Expense[] = [];
  private allIncomes: Income[] = [];

  /** Expenses that pass the filters, sorted — whichever tab is showing. */
  expenses: Expense[] = [];
  /** Money in that passes the filters, sorted. */
  incomes: Income[] = [];
  /** What the table draws: the tab's share of the two lists above. */
  rows: TransactionRow[] = [];

  /** The owner's own spending: of a split expense, only their share. */
  total = 0;
  /** Money that came in as income — repayments are not income. */
  moneyIn = 0;
  /** Money people handed back for their part of a split. */
  paidBack = 0;

  /** Split expenses by id, with their repayments, for the details drawer. */
  splits = new Map<string, SplitSummary>();

  /** The row whose details drawer is open, if any. */
  openRow: TransactionRow | null = null;

  loading = true;

  currentYear = new Date().getFullYear();
  recentYearsCount = 5;

  selectedMonth = 0;
  selectedYear = 0;
  /** '' is "all"; UNCATEGORISED selects the entries with no category. */
  selectedCategory = '';

  /** Only the categories actually used, so the filter never offers a dead end. */
  usedCategories: string[] = [];

  canApprovePending = false;
  canViewSourceDetails = false;
  canRemoveExpenses = false;

  sortColumn: SortColumn | null = null;
  sortDirection: 'asc' | 'desc' | 'default' = 'default';

  years = [
    { value: 0, label: 'All' },
    ...Array.from({ length: this.recentYearsCount }, (_, i) => ({
      value: this.currentYear - i,
      label: (this.currentYear - i).toString()
    })),
    { value: -1, label: '< 5 Years' }
  ];

  months = [
    { value: 0, label: 'All' },
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
  ];

  ngOnInit(): void {
    const requested = this.route?.snapshot.queryParamMap.get('tab') as TransactionTab | null;

    if (requested && TABS.includes(requested)) {
      this.tab = requested;
    }

    this.reload();
  }

  /** After an import: the new entries, and the totals with them. */
  onImported(): void {
    this.reload();
  }

  private reload(): void {
    forkJoin({
      expenses: this.expenseService.list(),
      incomes: this.incomeService.list(),
      splits: this.expenseService.listSplits(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ expenses, incomes, splits }) => {
        this.allExpenses = expenses;
        this.allIncomes = incomes;
        this.splits = new Map(splits.map(split => [split.id, split]));
        this.collectCategories();
        this.setViewPermission();
        this.applyFilters();
        this.loading = false;
      },
      error: error => {
        this.toast.error(error.message);
        this.loading = false;
      }
    });
  }

  /** What a piece of money in is filed under, for the filter and the chip. */
  private incomeCategory(income: Income): string {
    return income.splitExpenseId ? REPAYMENT : income.category ?? UNCATEGORISED;
  }

  /** The categories in use on the tab showing, so each tab filters by its own. */
  private collectCategories(): void {
    const names = new Set<string>();

    if (this.tab !== 'in') {
      this.allExpenses.forEach(expense => names.add(expense.category ?? UNCATEGORISED));
    }

    if (this.tab !== 'out') {
      this.allIncomes.forEach(income => names.add(this.incomeCategory(income)));
    }

    this.usedCategories = [...names].sort();

    // A filter left pointing at a category that no longer has entries would
    // show an empty list with no clue why.
    if (this.selectedCategory && !names.has(this.selectedCategory)) {
      this.selectedCategory = '';
    }
  }

  setViewPermission(): void {
    this.canViewSourceDetails = this.settingsService.canViewSource;
    this.canApprovePending = this.settingsService.canBackdate;
    this.canRemoveExpenses = this.settingsService.canRemove;
  }

  /** Switches half of the ledger, and records it in the address for a refresh. */
  onTab(tab: TransactionTab): void {
    if (tab === this.tab) {
      return;
    }

    this.tab = tab;
    this.openRow = null;
    this.collectCategories();
    this.applyFilters();

    this.router?.navigate([], {
      relativeTo: this.route ?? undefined,
      queryParams: { tab: tab === 'all' ? null : tab },
      replaceUrl: true
    });
  }

  onApprovePending(expense: Expense): void {
    this.expenseService.approve(expense.id).subscribe({
      next: approved => {
        this.toast.success('Approved.');

        // Approval is when it starts counting, so it can carry a budget over.
        for (const alert of approved.budgetAlerts ?? []) {
          this.toast.warning(alert.message);
        }

        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  /** The split a row belongs to: its own if it was split, or the one a repayment pays back. */
  splitFor(row: TransactionRow): SplitSummary | null {
    const id = row.expense?.splitMembers ? row.expense.id : row.income?.splitExpenseId;

    return id ? this.splits.get(id) ?? null : null;
  }

  /** Any row opens its details: an expense or money in alike. */
  onOpenRow(row: TransactionRow): void {
    this.openRow = row;
  }

  closeDetails(): void {
    this.openRow = null;
  }

  /** From a repayment's details, the split expense it pays back. */
  onOpenSplitExpense(id: string): void {
    const expense = this.allExpenses.find(e => e.id === id);

    if (expense) {
      this.openRow = this.fromExpense(expense);
    }
  }

  /** Remove, confirmed in the drawer. */
  onRemoveOpen(): void {
    const row = this.openRow;
    this.openRow = null;

    if (row?.expense) {
      this.onDelete(row.expense);
    } else if (row?.income) {
      this.onDeleteIncome(row.income);
    }
  }

  onApproveOpen(): void {
    const expense = this.openRow?.expense;
    this.openRow = null;

    if (expense) {
      this.onApprovePending(expense);
    }
  }

  /** A receipt was added or removed in the drawer; the paperclip follows. */
  onAttachmentCount(count: number): void {
    if (this.openRow?.expense) {
      this.openRow.expense.attachmentCount = count;
    }
  }

  onDelete(expense: Expense): void {
    this.expenseService.remove(expense.id).subscribe({
      next: removed => {
        // Repayments made against it stay, as ordinary money in; saying so
        // explains why they are still listed.
        const detached = removed.detachedRepayments
          ? ` Its ${removed.detachedRepayments} repayment(s) stay as money in.`
          : '';

        // Say so when money went back, otherwise the balance silently changing
        // looks like a second bug.
        this.toast.success(
          (removed.refunded
            ? `Removed. ₹${Number(expense.amount).toLocaleString()} put back ` +
              `into ${removed.sourceCategory}.`
            : 'Removed.') + detached
        );

        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  /**
   * Removing money in takes it back out of the account. The server refuses
   * when the account has since been spent below it, and says why.
   */
  onDeleteIncome(income: Income): void {
    this.incomeService.remove(income.id).subscribe({
      next: removed => {
        this.toast.success(
          removed.reversed
            ? `Removed. ₹${Number(income.amount).toLocaleString()} taken back out ` +
              `of ${removed.targetCategory}.`
            : 'Removed.'
        );

        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  onFilterMonth(event: Event): void {
    this.selectedMonth = Number((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  onFilterYear(event: Event): void {
    this.selectedYear = Number((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  onFilterCategory(event: Event): void {
    this.selectedCategory = (event.target as HTMLSelectElement).value;
    this.applyFilters();
  }

  /** True when anything differs from the full list: a tab, year, month or category. */
  get hasFilters(): boolean {
    return this.tab !== 'all' || this.selectedYear !== 0 || this.selectedMonth !== 0 || !!this.selectedCategory;
  }

  /** Back to everything: All, every year, month and category. */
  resetFilters(): void {
    this.selectedYear = 0;
    this.selectedMonth = 0;
    this.selectedCategory = '';

    if (this.tab !== 'all') {
      // Also clears the tab from the address and re-lists the categories.
      this.onTab('all');
    } else {
      this.collectCategories();
      this.applyFilters();
    }
  }

  /** True when a date falls inside the chosen year and month. */
  private inPeriod(date: string): boolean {
    const parsed = parseLocalDate(date);

    if (this.selectedMonth !== 0 && parsed.getMonth() !== this.selectedMonth - 1) {
      return false;
    }

    if (this.selectedYear === -1) {
      return parsed.getFullYear() < this.currentYear - this.recentYearsCount + 1;
    }

    return this.selectedYear === 0 || parsed.getFullYear() === this.selectedYear;
  }

  applyFilters(): void {
    const expenseRows = this.allExpenses
      .filter(expense => this.inPeriod(expense.date))
      .filter(expense =>
        !this.selectedCategory ||
        (expense.category ?? UNCATEGORISED) === this.selectedCategory
      )
      .map(expense => this.fromExpense(expense));

    const incomeRows = this.allIncomes
      .filter(income => this.inPeriod(income.date))
      .filter(income =>
        !this.selectedCategory || this.incomeCategory(income) === this.selectedCategory
      )
      .map(income => this.fromIncome(income));

    const sorted = this.applySorting([...expenseRows, ...incomeRows]);

    this.expenses = sorted.filter(row => row.expense).map(row => row.expense!);
    this.incomes = sorted.filter(row => row.income).map(row => row.income!);
    this.rows = this.tab === 'all' ? sorted : sorted.filter(row => row.kind === this.tab);

    this.total = this.expenseService.totalOf(this.expenses);
    this.moneyIn = this.sum(this.incomes.filter(income => !income.splitExpenseId));
    this.paidBack = this.sum(this.incomes.filter(income => income.splitExpenseId));
  }

  private sum(incomes: Income[]): number {
    return incomes.reduce((total, income) => total + Number(income.amount), 0);
  }

  private fromExpense(expense: Expense): TransactionRow {
    return {
      key: `out:${expense.id}`,
      kind: 'out',
      date: expense.date,
      amount: Number(expense.amount),
      description: expense.description,
      category: expense.category ?? UNCATEGORISED,
      account: expense.sourceCategory,
      status: expense.isPendingApproval ? 'Pending approval' : 'Completed',
      createdAt: expense.createdAt,
      expense
    };
  }

  private fromIncome(income: Income): TransactionRow {
    return {
      key: `in:${income.id}`,
      kind: 'in',
      date: income.date,
      amount: Number(income.amount),
      description: income.description,
      category: this.incomeCategory(income),
      account: income.targetCategory,
      status: 'Credit',
      createdAt: income.createdAt,
      income
    };
  }

  onSort(column: SortColumn): void {
    if (this.sortColumn !== column) {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else if (this.sortDirection === 'desc') {
      this.sortDirection = 'default';
      this.sortColumn = null;
    } else {
      this.sortDirection = 'asc';
    }

    this.applyFilters();
  }

  applySorting(rows: TransactionRow[]): TransactionRow[] {
    // Default: the latest entry first. Entries are never edited after they
    // are added, so the last one added is the last one updated.
    if (!this.sortColumn || this.sortDirection === 'default') {
      return [...rows].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const column = this.sortColumn;
    const direction = this.sortDirection === 'asc' ? 1 : -1;

    const value = (row: TransactionRow): number | string => {
      if (column === 'date') {
        return parseLocalDate(row.date).getTime();
      }

      if (column === 'amount') {
        return row.amount;
      }

      return String(row[column] ?? '').toLowerCase();
    };

    return [...rows].sort((a, b) => {
      const valueA = value(a);
      const valueB = value(b);

      return valueA < valueB ? -direction : valueA > valueB ? direction : 0;
    });
  }

  /** The list's heading, naming the tab showing. */
  get listTitle(): string {
    return this.tab === 'out' ? 'Debit' : this.tab === 'in' ? 'Credit' : 'All transactions';
  }

  /** True when the tab showing has anything to export. */
  get canExport(): boolean {
    return this.rows.length > 0;
  }

  /**
   * Downloads the rows currently on screen, filters, sorting and all.
   *
   * Built here rather than on the server: the list is already loaded, and
   * exporting what the user can actually see means the permission rules are
   * applied once instead of twice. Each tab exports its own shape; Money out
   * is the same file the old View Expenses page produced.
   */
  onExportCsv(): void {
    if (!this.canExport) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    if (this.tab === 'out') {
      downloadCsv(`expenses-${today}.csv`, ...this.expenseCsv());
    } else if (this.tab === 'in') {
      downloadCsv(`money-in-${today}.csv`, ...this.incomeCsv());
    } else {
      downloadCsv(`transactions-${today}.csv`, ...this.allCsv());
    }
  }

  private expenseCsv(): [string[], string[][]] {
    const headers = ['Date', 'Amount', 'Description', 'Category'];

    if (this.canViewSourceDetails) {
      headers.push('Source Type', 'Account');
    }

    // Last, so a sheet built on the earlier columns keeps reading them where
    // they were. Blank on an expense that was not split.
    headers.push('Status', 'Remarks', 'Split Between', 'Your Share');

    const rows = this.expenses.map(expense => {
      const cells = [
        expense.date,
        String(expense.amount),
        expense.description,
        expense.category ?? UNCATEGORISED
      ];

      if (this.canViewSourceDetails) {
        cells.push(expense.sourceType ?? '', expense.sourceCategory ?? '');
      }

      cells.push(
        expense.status,
        expense.remarks ?? '',
        expense.splitMembers ? String(expense.splitMembers) : '',
        expense.splitMembers ? String(expense.personalShare) : ''
      );

      return cells;
    });

    return [headers, rows];
  }

  private incomeCsv(): [string[], string[][]] {
    const headers = ['Date', 'Amount', 'Description', 'Where It Came From'];

    if (this.canViewSourceDetails) {
      headers.push('Account');
    }

    headers.push('Pays Back');

    const rows = this.incomes.map(income => {
      const cells = [
        income.date,
        String(income.amount),
        income.description,
        this.incomeCategory(income)
      ];

      if (this.canViewSourceDetails) {
        cells.push(income.targetCategory ?? '');
      }

      cells.push(income.splitDescription ?? '');

      return cells;
    });

    return [headers, rows];
  }

  /** Both kinds in one sheet, with a Type column to tell them apart. */
  private allCsv(): [string[], string[][]] {
    const headers = ['Date', 'Type', 'Amount', 'Description', 'Category'];

    if (this.canViewSourceDetails) {
      headers.push('Account');
    }

    headers.push('Status', 'Your Share', 'Pays Back');

    const rows = this.rows.map(row => {
      const cells = [
        row.date,
        row.kind === 'out' ? 'Debit' : 'Credit',
        String(row.amount),
        row.description,
        row.category
      ];

      if (this.canViewSourceDetails) {
        cells.push(row.account ?? '');
      }

      cells.push(
        row.status,
        row.expense?.splitMembers ? String(row.expense.personalShare) : '',
        row.income?.splitDescription ?? ''
      );

      return cells;
    });

    return [headers, rows];
  }

  getSortIcon(column: SortColumn): string {
    if (this.sortColumn !== column) {
      return '';
    }

    if (this.sortDirection === 'asc') {
      return ' ↑';
    }

    if (this.sortDirection === 'desc') {
      return ' ↓';
    }

    return '';
  }
}
