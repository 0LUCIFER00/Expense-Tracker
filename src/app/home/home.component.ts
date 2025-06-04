import { Component } from '@angular/core';
import { Expense } from '../shared/expense.model';
import { ExpenseService } from '../shared/expense.service';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  imports: [CommonModule, RouterModule],
})
export class HomeComponent {
  today = new Date();
  subscribe: any;
  expenses: Expense[] = [];
  totalSpent: number = 0;
  currentMonthSpent: number = 0;
  lastMonthSpent: number = 0;
  totalExpenses: number = 0;

  constructor(private expenseService: ExpenseService) {}

  ngOnInit() {
    this.expenses = this.expenseService.getExpenses();
    this.totalSpent = this.expenses.reduce((acc, e) => acc + e.amount, 0);
    this.totalExpenses = this.expenses.length;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    this.currentMonthSpent = this.expenses
      .filter((e) => {
        const date = new Date(e.date);
        return (
          date.getMonth() === currentMonth && date.getFullYear() === currentYear
        );
      })
      .reduce((acc, e) => acc + e.amount, 0);
    this.lastMonthSpent = this.expenses
      .filter((e) => {
        const date = new Date(e.date);
        return (
          date.getMonth() === currentMonth-1 && date.getFullYear() === currentYear
        );
      })
      .reduce((acc, e) => acc + e.amount, 0);
  }
}
