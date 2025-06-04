import {
  Injectable,
  provideExperimentalZonelessChangeDetection,
} from '@angular/core';
import { Expense } from './expense.model';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private expenses: Expense[] = [];
  private alterExpenses: Expense[] = [];
  private expensesSubject = new BehaviorSubject<Expense[]>([]);
  constructor() {
    const storedExpenses = localStorage.getItem('expenses');
    this.expenses = storedExpenses ? JSON.parse(storedExpenses) : [];
  }

  private saveToLocalStorage(expenses: Expense[]) {
    localStorage.setItem('expenses', JSON.stringify(expenses));
  }

  getExpenses() {
    this.alterExpenses = this.expenses;
    return this.alterExpenses;
  }

  forTotal(expenses: Expense[]) {
    return expenses.reduce((sum, e) => sum + e.amount, 0);
  }

  addExpense(expense: Expense) {
    this.expenses.push(expense);
    this.saveToLocalStorage(this.expenses);
  }

  deleteExpense(expense: Expense) {
    let index = this.expenses.indexOf(expense);
    this.expenses.splice(index, 1);
    // this.saveToLocalStorage(this.expenses);
  }

  filterByMonth(month: number): Expense[] {
    return this.alterExpenses.filter((e) => new Date(e.date).getMonth() === month);
  }

  filterByYear(year: number): Expense[] {
    this.alterExpenses = this.expenses.filter((e) => new Date(e.date).getFullYear() === year);
    return this.alterExpenses;
  }

  alterExpen(){
    return this.alterExpenses;
  }
}
