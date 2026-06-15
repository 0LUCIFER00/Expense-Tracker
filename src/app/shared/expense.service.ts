import { Injectable } from '@angular/core';
import { Expense } from './expense.model';

@Injectable({
  providedIn: 'root'
})
export class ExpenseService {
  private expenses: Expense[] = [];
  private pendingExpenses: Expense[] = [];
  private alterExpenses: Expense[] = [];

  constructor() {
    const storedExpenses = localStorage.getItem('expenses');
    const storedPendingExpenses = localStorage.getItem('pendingExpenses');

    this.expenses = storedExpenses ? JSON.parse(storedExpenses) : [];
    this.pendingExpenses = storedPendingExpenses ? JSON.parse(storedPendingExpenses) : [];
  }

  private saveExpenses() {
    localStorage.setItem('expenses', JSON.stringify(this.expenses));
  }

  private savePendingExpenses() {
    localStorage.setItem('pendingExpenses', JSON.stringify(this.pendingExpenses));
  }

  getExpenses(): Expense[] {
  this.alterExpenses = [
    ...this.expenses,
    ...this.pendingExpenses
  ];

  return this.alterExpenses;
}

  getPendingExpenses(): Expense[] {
    return this.pendingExpenses;
  }

  forTotal(expenses: Expense[]) {
    return expenses
      .filter(e => e.status === 'Done')
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }

  addExpense(expense: Expense) {
    this.expenses.push(expense);
    this.saveExpenses();
  }

  addPendingExpense(expense: Expense) {
    this.pendingExpenses.push(expense);
    this.savePendingExpenses();
  }

  deleteExpense(expense: Expense) {
    if (expense.isPendingApproval) {
      this.pendingExpenses = this.pendingExpenses.filter(e => e.id !== expense.id);
      this.savePendingExpenses();
    } else {
      this.expenses = this.expenses.filter(e => e.id !== expense.id);
      this.saveExpenses();
    }
  }

  filterByMonth(month: number): Expense[] {
    return this.alterExpenses.filter(
      e => new Date(e.date).getMonth() === month
    );
  }

  filterByYear(year: number): Expense[] {
    this.alterExpenses = this.getExpenses().filter(
      e => new Date(e.date).getFullYear() === year
    );

    return this.alterExpenses;
  }

  alterExpen() {
    return this.alterExpenses;
  }
  
  approvePendingExpense(expense: Expense): boolean {
  const pendingExpense = this.pendingExpenses.find(
    (e: Expense) => e.id === expense.id
  );

  if (!pendingExpense) {
    return false;
  }

  if (pendingExpense.expenseAccess) {
    const balances = JSON.parse(localStorage.getItem('balances') || '[]');

    const selectedBalance = balances.find(
      (b: any) => b.id == pendingExpense.sourceId
    );

    if (!selectedBalance) {
      alert('Balance account not found.');
      return false;
    }

    if (Number(selectedBalance.balance) < Number(pendingExpense.amount)) {
      alert('Insufficient balance.');
      return false;
    }

    selectedBalance.balance =
      Number(selectedBalance.balance) - Number(pendingExpense.amount);

    localStorage.setItem('balances', JSON.stringify(balances));
  }

  const approvedExpense: Expense = {
    ...pendingExpense,
    status: 'Done',
    balanceUpdated: !!pendingExpense.expenseAccess,
    updatePermission: true,
    isPendingApproval: false,
    remarks: pendingExpense.expenseAccess
      ? 'Added and balance updated by admin'
      : 'Added in list by admin'
  };

  // Add to normal expenses array
  this.expenses.push(approvedExpense);

  // Remove from pending array
  this.pendingExpenses = this.pendingExpenses.filter(
    (e: Expense) => e.id !== expense.id
  );

  // Save both arrays
  localStorage.setItem('expenses', JSON.stringify(this.expenses));
  localStorage.setItem('pendingExpenses', JSON.stringify(this.pendingExpenses));

  return true;
}
}