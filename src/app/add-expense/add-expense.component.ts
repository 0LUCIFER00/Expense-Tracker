import { Component } from '@angular/core';
import {
  FormGroup,
  FormBuilder,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { ExpenseService } from '../shared/expense.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-add-expense',
  imports: [ReactiveFormsModule, CommonModule],
  templateUrl: './add-expense.component.html',
  styleUrl: './add-expense.component.css',
})
export class AddExpenseComponent {
  expenseForm: FormGroup;

  constructor(private fb: FormBuilder, private expenseService: ExpenseService) {
    this.expenseForm = this.fb.group({
      amount: ['', [Validators.required, Validators.min(1), Validators.max(100000)]],
      description: ['', Validators.required],
      date: ['', Validators.required],
    });
  }

  onSubmit() {
    if (this.expenseForm.valid) {
        this.expenseService.addExpense(this.expenseForm.value);
        this.expenseForm.reset();
    }
  }
}
