import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { Expense } from '../shared/models';
import { ExpenseService, UNCATEGORISED } from '../shared/expense.service';
import { downloadCsv } from '../shared/csv';
import { ToastService } from '../shared/toast.service';
import { SettingsService } from '../shared/settings.service';
import { parseLocalDate } from '../shared/date-utils';

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.css'
})
export class ExpenseListComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);

  /** Everything the server returned; `expenses` is the filtered view of it. */
  private allExpenses: Expense[] = [];

  expenses: Expense[] = [];
  total = 0;

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

  sortColumn: keyof Expense | null = null;
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
    this.reload();
  }

  private reload(): void {
    forkJoin({
      expenses: this.expenseService.list(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ expenses }) => {
        this.allExpenses = expenses;
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

  private collectCategories(): void {
    const names = new Set(
      this.allExpenses.map(expense => expense.category ?? UNCATEGORISED)
    );

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

  onApprovePending(expense: Expense): void {
    this.expenseService.approve(expense.id).subscribe({
      next: () => {
        this.toast.success('Approved.');
        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  onDelete(expense: Expense): void {
    this.expenseService.remove(expense.id).subscribe({
      next: removed => {
        // Say so when money went back, otherwise the balance silently changing
        // looks like a second bug.
        this.toast.success(
          removed.refunded
            ? `Removed. ₹${Number(expense.amount).toLocaleString()} put back ` +
              `into ${removed.sourceCategory}.`
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

  applyFilters(): void {
    let filtered = [...this.allExpenses];

    if (this.selectedMonth !== 0) {
      filtered = filtered.filter(
        expense => parseLocalDate(expense.date).getMonth() === this.selectedMonth - 1
      );
    }

    if (this.selectedYear === -1) {
      const limitYear = this.currentYear - this.recentYearsCount + 1;
      filtered = filtered.filter(
        expense => parseLocalDate(expense.date).getFullYear() < limitYear
      );
    } else if (this.selectedYear !== 0) {
      filtered = filtered.filter(
        expense => parseLocalDate(expense.date).getFullYear() === this.selectedYear
      );
    }

    if (this.selectedCategory) {
      filtered = filtered.filter(
        expense => (expense.category ?? UNCATEGORISED) === this.selectedCategory
      );
    }

    this.expenses = this.applySorting(filtered);
    this.total = this.expenseService.totalOf(this.expenses);
  }

  onSort(column: keyof Expense): void {
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

  applySorting(expenses: Expense[]): Expense[] {
    // Default is the order the entries were created in.
    if (!this.sortColumn || this.sortDirection === 'default') {
      return [...expenses].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    }

    const column = this.sortColumn;

    return [...expenses].sort((a: any, b: any) => {
      let valueA = a[column as string];
      let valueB = b[column as string];

      if (column === 'date') {
        valueA = parseLocalDate(valueA).getTime();
        valueB = parseLocalDate(valueB).getTime();
      }

      if (column === 'amount') {
        valueA = Number(valueA);
        valueB = Number(valueB);
      }

      if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase();
      }

      if (typeof valueB === 'string') {
        valueB = valueB.toLowerCase();
      }

      if (valueA < valueB) {
        return this.sortDirection === 'asc' ? -1 : 1;
      }

      if (valueA > valueB) {
        return this.sortDirection === 'asc' ? 1 : -1;
      }

      return 0;
    });
  }

  /**
   * Downloads the rows currently on screen, filters, sorting and all.
   *
   * Built here rather than on the server: the list is already loaded, and
   * exporting what the user can actually see means the permission rules are
   * applied once instead of twice.
   */
  onExportCsv(): void {
    if (this.expenses.length === 0) {
      return;
    }

    const headers = ['Date', 'Amount', 'Description', 'Category'];

    if (this.canViewSourceDetails) {
      headers.push('Source Type', 'Account');
    }

    headers.push('Status', 'Remarks');

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

      cells.push(expense.status, expense.remarks ?? '');

      return cells;
    });

    downloadCsv(
      `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows
    );
  }

  getSortIcon(column: keyof Expense): string {
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
