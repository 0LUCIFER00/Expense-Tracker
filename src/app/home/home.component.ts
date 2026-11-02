import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Expense } from '../shared/models';
import { ExpenseService } from '../shared/expense.service';
import { parseLocalDate } from '../shared/date-utils';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  imports: [CommonModule, RouterModule]
})
export class HomeComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);

  today = new Date();
  expenses: Expense[] = [];
  totalSpent = 0;
  currentMonthSpent = 0;
  lastMonthSpent = 0;
  totalExpenses = 0;
  loading = true;
  loadError = '';

  ngOnInit(): void {
    this.expenseService.list().subscribe({
      next: expenses => {
        this.expenses = expenses;
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
    this.totalSpent = this.sum(this.expenses);
    this.totalExpenses = this.expenses.length;

    const now = new Date();

    // Rolling back a month has to carry into the previous year, otherwise
    // January looks for month -1 and always reports zero.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    this.currentMonthSpent = this.sumForMonth(now.getMonth(), now.getFullYear());
    this.lastMonthSpent = this.sumForMonth(lastMonth.getMonth(), lastMonth.getFullYear());
  }

  private sumForMonth(month: number, year: number): number {
    return this.sum(
      this.expenses.filter(expense => {
        const date = parseLocalDate(expense.date);
        return date.getMonth() === month && date.getFullYear() === year;
      })
    );
  }

  private sum(expenses: Expense[]): number {
    return expenses.reduce((total, expense) => total + Number(expense.amount), 0);
  }
}
