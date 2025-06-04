import { Component, Input } from '@angular/core';
import { Expense } from '../shared/expense.model';
import { CommonModule } from '@angular/common';
import { ExpenseService } from '../shared/expense.service';
import { TotalSummaryComponent } from '../total-summary/total-summary.component';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-expense-list',
  imports: [CommonModule, TotalSummaryComponent, FormsModule],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.css',
})
export class ExpenseListComponent {
  expenses: Expense[] = [];
  total = 0;

  years = [
    { value: 0, label: 'All' },
    { value: 2025, label: '2025' },
    { value: 2024, label: '2024' },
    { value: 2023, label: '2023' },
    { value: 2022, label: '2022' },
    { value: 2021, label: '2021' },
    { value: 2020, label: '< 2021' },
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
  ngOnInit() {
    this.allExpense();
  }

  constructor(private expenseService: ExpenseService) {}

  allExpense() {
    this.expenses = this.expenseService.getExpenses();
    // .sort((a, b) =>
    //   new Date(a.date).getMonth() - new Date(b.date).getMonth()
    // );
    this.total = this.expenseService.forTotal(this.expenses);
  }

  month: any;
  year: any;
  onFilterMonth(month: any) {
    this.month = month;
    const monthNum = month.value;
    if (monthNum == 0) {
      this.expenses = this.expenseService.alterExpen();
    } else {
      this.expenses = this.expenseService.filterByMonth(monthNum - 1);
    }
    this.total = this.expenseService.forTotal(this.expenses);
  }

  onFilterYear(year: any) {
    this.year = year;
    const yearNum = year.value;

    const input = document.getElementById('monthFilter') as HTMLInputElement;
    if (yearNum == 0) {
      this.expenses = this.expenseService.getExpenses();
    } else {
      this.expenses = this.expenseService.filterByYear(yearNum - 0);
    }
    this.onFilterMonth(input);
    this.total = this.expenseService.forTotal(this.expenses);
  }

  onDelete(expense: Expense) {
    this.expenseService.deleteExpense(expense);
    this.allExpense();
    if (this.year) {
      this.onFilterYear(this.year);
    }
    if (this.month) {
      this.onFilterMonth(this.month);
    }
  }
}
