import { Component, OnInit } from '@angular/core';
import {
  FormGroup,
  FormBuilder,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { ExpenseService } from '../shared/expense.service';
import { CommonModule } from '@angular/common';
import { UserService } from '../shared/user.service';
import { ExpenseDatePopupComponent } from './expense-date-popup/expense-date-popup.component';
import { Expense } from '../shared/expense.model';

@Component({
  selector: 'app-add-expense',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, ExpenseDatePopupComponent],
  templateUrl: './add-expense.component.html',
  styleUrl: './add-expense.component.css',
})
export class AddExpenseComponent implements OnInit {
  expenseForm: FormGroup;
  availableBalances: any[] = [];

  expenseAccess = false;
  updatePermission = false;

  showDatePopup = false;
  popupType: 'past' | 'future' = 'past';

  pendingExpenseAccess = false;
  pendingFormValue: any = null;
  pendingSelectedBalance: any = null;
  pendingBalances: any[] = [];

  constructor(
    private fb: FormBuilder,
    private expenseService: ExpenseService,
    private userService: UserService
  ) {
    const today = new Date().toISOString().split('T')[0];

    this.expenseForm = this.fb.group({
      source: [''],
      amount: [
        '',
        [Validators.required, Validators.min(1), Validators.max(100000)],
      ],
      description: ['', Validators.required],
      date: [today, Validators.required],
    });
  }

  ngOnInit() {
    this.loadBalances();
    this.loadAccessSettings();
  }

  loadAccessSettings() {
    const settings = this.userService.getSettingsAccess();

    const loginType = localStorage.getItem('loginType');
    const isAdmin = loginType === 'admin';

    this.expenseAccess = isAdmin
      ? settings.expenseAdminAccess
      : settings.expenseUserAccess;

    this.updatePermission = isAdmin
      ? settings.updatePermissionAdmin
      : settings.updatePermissionUser;

    if (this.expenseAccess) {
      this.expenseForm.get('source')?.enable();
    } else {
      this.expenseForm.get('source')?.disable();
      this.expenseForm.get('source')?.setValue('');
    }
  }

  loadBalances() {
    const balances = JSON.parse(localStorage.getItem('balances') || '[]');

    this.availableBalances = balances.filter((item: any) => item.saved);
  }

  isMainFormInvalid(): boolean {
    return !!(
      this.expenseForm.get('amount')?.invalid ||
      this.expenseForm.get('description')?.invalid ||
      this.expenseForm.get('date')?.invalid
    );
  }

  onSubmit(expenseAccessButton: boolean) {
    if (this.isMainFormInvalid()) {
      return;
    }

    const formValue = this.expenseForm.getRawValue();
    const amount = Number(formValue.amount);

    const shouldUpdateBalance = expenseAccessButton && this.expenseAccess;

    let selectedBalance: any = null;
    let balances: any[] = [];

    if (shouldUpdateBalance) {
      balances = JSON.parse(localStorage.getItem('balances') || '[]');

      selectedBalance = balances.find(
        (item: any) => item.id == formValue.source
      );

      if (!selectedBalance) {
        alert('Please select a valid balance account.');
        return;
      }

      if (Number(selectedBalance.balance) < amount) {
        alert('Insufficient balance.');
        return;
      }
    }

    const selectedDate = new Date(formValue.date);
    const today = new Date();

    selectedDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    this.pendingExpenseAccess = shouldUpdateBalance;
    this.pendingFormValue = formValue;
    this.pendingSelectedBalance = selectedBalance;
    this.pendingBalances = balances;

    const isToday = selectedDate.getTime() === today.getTime();

    if (isToday) {
      this.saveDoneExpense();
      return;
    }

    if (selectedDate < today) {
      this.popupType = 'past';
      this.showDatePopup = true;
      return;
    }

    if (selectedDate > today) {
      this.popupType = 'future';
      this.showDatePopup = true;
      return;
    }
  }

  closeDatePopup() {
    this.showDatePopup = false;
  }

  addFromPopup() {
    this.showDatePopup = false;

    if (this.updatePermission) {
      this.saveDoneExpense();
    } else {
      this.savePendingExpense();
    }
  }

  adminPermissionFromPopup() {
    this.showDatePopup = false;
    this.savePendingExpense();
  }

  saveDoneExpense() {
    const formValue = this.pendingFormValue;
    const amount = Number(formValue.amount);

    const selectedBalance = this.pendingSelectedBalance;
    const balances = this.pendingBalances;

    if (this.pendingExpenseAccess && selectedBalance) {
      selectedBalance.balance = Number(selectedBalance.balance) - amount;
      localStorage.setItem('balances', JSON.stringify(balances));
    }

    const expenseData: Expense = {
      id: Date.now(),
      ...formValue,

      sourceId: selectedBalance?.id || null,
      sourceType: selectedBalance?.type || null,
      sourceCategory: selectedBalance?.category || null,

      amount: amount,

      expenseAccess: this.pendingExpenseAccess,
      updatePermission: this.updatePermission,

      balanceUpdated: this.pendingExpenseAccess,

      status: 'Done',
      remarks: this.pendingExpenseAccess
        ? 'Added and balance updated'
        : 'Added in list',

      isPendingApproval: false,
      createdAt: new Date().toISOString(),
    };

    this.expenseService.addExpense(expenseData);
    this.resetForm();
  }

  savePendingExpense() {
    const formValue = this.pendingFormValue;
    const amount = Number(formValue.amount);

    const selectedBalance = this.pendingSelectedBalance;

    const expenseData: Expense = {
      id: Date.now(),
      ...formValue,

      sourceId: selectedBalance?.id || null,
      sourceType: selectedBalance?.type || null,
      sourceCategory: selectedBalance?.category || null,

      amount: amount,

      expenseAccess: this.pendingExpenseAccess,
      updatePermission: false,

      balanceUpdated: false,

      status: 'Pending / Waiting Admin',
      remarks: this.pendingExpenseAccess
        ? 'Wait for admin to add and update balance'
        : 'Wait for admin to add',

      isPendingApproval: true,
      createdAt: new Date().toISOString(),
    };

    this.expenseService.addPendingExpense(expenseData);
    this.resetForm();
  }

  resetForm() {
    const currentDate = new Date().toISOString().split('T')[0];

    this.expenseForm.reset({
      source: '',
      amount: '',
      description: '',
      date: currentDate,
    });

    this.loadBalances();
    this.loadAccessSettings();
  }
}