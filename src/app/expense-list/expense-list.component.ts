import { Component, OnInit } from '@angular/core';
import { Expense } from '../shared/expense.model';
import { CommonModule } from '@angular/common';
import { ExpenseService } from '../shared/expense.service';
import { TotalSummaryComponent } from '../total-summary/total-summary.component';
import { FormsModule } from '@angular/forms';
import { UserService } from '../shared/user.service';

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, TotalSummaryComponent, FormsModule],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.css',
})
export class ExpenseListComponent implements OnInit {
  expenses: Expense[] = [];
  total = 0;

  currentYear = new Date().getFullYear();
  recentYearsCount = 5;

  selectedMonth = 0;
  selectedYear = 0;

  canApprovePending = false;

  canViewSourceDetails = false;

  sortColumn: keyof Expense | null = null;
  sortDirection: 'asc' | 'desc' | 'default' = 'default';

  years = [
    { value: 0, label: 'All' },
    ...Array.from({ length: this.recentYearsCount }, (_, i) => ({
      value: this.currentYear - i,
      label: (this.currentYear - i).toString(),
    })),
    { value: -1, label: '< 5 Years' },
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
    { value: 12, label: 'December' },
  ];

  constructor(
    private expenseService: ExpenseService,
    private userService: UserService
  ) { }

  ngOnInit(): void {
    this.setViewPermission();
    this.applyFilters();
  }

  setViewPermission(): void {
    const loginType = localStorage.getItem('loginType');
    const settings = this.userService.getSettingsAccess();

    if (loginType === 'admin') {
      this.canViewSourceDetails = settings.viewPermissionAdmin;
      this.canApprovePending = settings.updatePermissionAdmin;
    } else {
      this.canViewSourceDetails = settings.viewPermissionUser;
      this.canApprovePending = settings.updatePermissionUser;
    }
  }

  onApprovePending(expense: Expense): void {
    const approved = this.expenseService.approvePendingExpense(expense);

    if (approved) {
      this.applyFilters();
    }
  }

  onFilterMonth(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedMonth = Number(target.value);
    this.applyFilters();
  }

  onFilterYear(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedYear = Number(target.value);
    this.applyFilters();
  }

  applyFilters(): void {
    let filteredExpenses = this.expenseService.getExpenses();

    if (this.selectedMonth !== 0) {
      filteredExpenses = filteredExpenses.filter(
        (expense) => new Date(expense.date).getMonth() === this.selectedMonth - 1
      );
    }

    if (this.selectedYear === -1) {
      const limitYear = this.currentYear - this.recentYearsCount + 1;
      filteredExpenses = filteredExpenses.filter(
        (expense) => new Date(expense.date).getFullYear() < limitYear
      );
    } else if (this.selectedYear !== 0) {
      filteredExpenses = filteredExpenses.filter(
        (expense) => new Date(expense.date).getFullYear() === this.selectedYear
      );
    }

    this.expenses = this.applySorting(filteredExpenses);
    this.total = this.expenseService.forTotal(this.expenses);
  }

  onDelete(expense: Expense): void {
    this.expenseService.deleteExpense(expense);
    this.applyFilters();
  }

  getExpenseStatus(expense: Expense): string {
    return expense.status || 'Pending / Waiting Admin';
  }

  getStatusClass(expense: Expense): string {
    if (expense.status === 'Done') {
      return 'status-done';
    }

    return 'status-pending';
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
    // Default user-added order
    if (!this.sortColumn || this.sortDirection === 'default') {
      return expenses.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number(a.id || 0);
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number(b.id || 0);

        return aTime - bTime;
      });
    }

    return expenses.sort((a: any, b: any) => {
      let valueA = a[this.sortColumn as string];
      let valueB = b[this.sortColumn as string];

      if (this.sortColumn === 'date') {
        valueA = new Date(valueA).getTime();
        valueB = new Date(valueB).getTime();
      }

      if (this.sortColumn === 'amount') {
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
