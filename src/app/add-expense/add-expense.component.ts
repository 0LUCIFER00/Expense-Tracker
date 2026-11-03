import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { forkJoin } from 'rxjs';
import { BalanceService } from '../shared/balance.service';
import { ExpenseService } from '../shared/expense.service';
import { SettingsService } from '../shared/settings.service';
import { BalanceAccount } from '../shared/models';
import { parseLocalDate, today } from '../shared/date-utils';
import { ExpenseDatePopupComponent } from './expense-date-popup/expense-date-popup.component';
import { RouterModule } from '@angular/router';
import { FitsScreenDirective } from '../shared/fits-screen.directive';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-add-expense',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CommonModule,
    RouterModule,
    FitsScreenDirective,
    ExpenseDatePopupComponent
  ],
  templateUrl: './add-expense.component.html',
  styleUrl: './add-expense.component.css'
})
export class AddExpenseComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);

  expenseForm: FormGroup = this.fb.group({
    source: [''],
    category: [''],
    amount: ['', [Validators.required, Validators.min(1), Validators.max(100000)]],
    description: ['', Validators.required],
    date: [today(), Validators.required]
  });

  availableBalances: BalanceAccount[] = [];
  categories: string[] = [];

  expenseAccess = false;
  updatePermission = false;
  canSeeBalances = false;

  showDatePopup = false;
  popupType: 'past' | 'future' = 'past';

  submitting = false;

  /** Set aside while the date-confirmation popup is open. */
  private pendingUpdateBalance = false;

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    forkJoin({
      balances: this.balanceService.list(),
      categories: this.expenseService.listCategories(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ balances, categories }) => {
        this.availableBalances = balances.filter(balance => balance.saved);
        this.categories = categories;
        this.applyPermissions();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  private applyPermissions(): void {
    this.expenseAccess = this.settingsService.canUpdateBalance;
    this.updatePermission = this.settingsService.canBackdate;
    this.canSeeBalances = this.settingsService.canSeeBalances;

    const source = this.expenseForm.get('source');

    if (this.expenseAccess) {
      source?.enable();
    } else {
      source?.disable();
      source?.setValue('');
    }
  }

  /** The account chosen under "Spend from", or null while none is. */
  get selectedAccount(): BalanceAccount | null {
    const id = this.expenseForm.get('source')?.value;

    return id ? this.availableBalances.find(account => account.id === id) ?? null : null;
  }

  /**
   * What the chosen account would hold once this expense is taken out.
   *
   * Null while there is nothing to work it out from — no account, no amount, or
   * a balance this session may not see.
   */
  get balanceAfter(): number | null {
    const account = this.selectedAccount;
    const amount = Number(this.expenseForm.get('amount')?.value);

    if (!account || account.balance === null || !Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    return Math.round((Number(account.balance) - amount) * 100) / 100;
  }

  /** A WhatsApp message that would file the expense being typed. */
  get sampleCommand(): string {
    const amount = Number(this.expenseForm.get('amount')?.value);
    const description = String(this.expenseForm.get('description')?.value ?? '').trim();

    const words = [
      Number.isFinite(amount) && amount > 0 ? String(amount) : '250',
      description ? description.split(/\s+/)[0].toLowerCase() : 'coffee'
    ];

    // The account's own name is what the parser matches on, so the example
    // uses the chosen one rather than a made-up bank.
    const account = this.selectedAccount;

    if (account) {
      words.push(account.category.split(/\s+/)[0].toLowerCase());
    }

    return words.join(' ');
  }

  /** The category chips are a picker over the same form control as before. */
  onPickCategory(name: string): void {
    this.expenseForm.get('category')?.setValue(name);
  }

  isMainFormInvalid(): boolean {
    return !!(
      this.expenseForm.get('amount')?.invalid ||
      this.expenseForm.get('description')?.invalid ||
      this.expenseForm.get('date')?.invalid
    );
  }

  onSubmit(updateBalance: boolean): void {
    if (this.isMainFormInvalid() || this.submitting) {
      return;
    }

    this.pendingUpdateBalance = updateBalance && this.expenseAccess;

    const selected = parseLocalDate(this.expenseForm.getRawValue().date);
    const now = new Date();

    selected.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);

    if (selected.getTime() === now.getTime()) {
      this.save();
      return;
    }

    // Anything other than today needs confirming. Whether it then settles or
    // queues for an admin is the server's call, from the same permission.
    this.popupType = selected < now ? 'past' : 'future';
    this.showDatePopup = true;
  }

  closeDatePopup(): void {
    this.showDatePopup = false;
  }

  /** Both popup buttons post the same thing; only the wording differs. */
  confirmFromPopup(): void {
    this.showDatePopup = false;
    this.save();
  }

  private save(): void {
    const form = this.expenseForm.getRawValue();

    this.submitting = true;

    this.expenseService
      .create({
        amount: Number(form.amount),
        description: form.description,
        date: form.date,
        category: form.category || null,
        sourceId: this.pendingUpdateBalance && form.source ? String(form.source) : null,
        updateBalance: this.pendingUpdateBalance,
        tzOffset: new Date().getTimezoneOffset()
      })
      .subscribe({
        next: expense => {
          this.submitting = false;

          this.toast.success(
            expense.status === 'Done'
              ? 'Expense added.'
              : 'Sent to an admin for approval.'
          );

          this.resetForm();
        },
        error: error => {
          this.submitting = false;
          this.toast.error(error.message);
        }
      });
  }

  private resetForm(): void {
    this.expenseForm.reset({
      source: '',
      category: '',
      amount: '',
      description: '',
      date: today()
    });

    this.reload();
  }
}
