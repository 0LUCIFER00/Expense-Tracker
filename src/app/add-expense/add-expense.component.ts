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
import {
  MAX_SPLIT_MEMBERS,
  MIN_SPLIT_MEMBERS,
  SplitPreview,
  splitAmount
} from '../shared/split';

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
    date: [today(), Validators.required],
    // Paid for a group: how many it is split between, the owner included.
    split: [false],
    members: [
      MIN_SPLIT_MEMBERS,
      [Validators.min(MIN_SPLIT_MEMBERS), Validators.max(MAX_SPLIT_MEMBERS)]
    ]
  });

  readonly minMembers = MIN_SPLIT_MEMBERS;
  readonly maxMembers = MAX_SPLIT_MEMBERS;

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

  /** The account chosen under "Debit from", or null while none is. */
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

  get isSplit(): boolean {
    return Boolean(this.expenseForm.get('split')?.value);
  }

  /**
   * What each person's part comes to, while "Split" is ticked and there is an
   * amount and a head count to work from; null otherwise.
   */
  get splitPreview(): SplitPreview | null {
    if (!this.isSplit) {
      return null;
    }

    return splitAmount(
      Number(this.expenseForm.get('amount')?.value),
      Number(this.expenseForm.get('members')?.value)
    );
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

    const split = this.splitPreview;

    if (split) {
      words.push('split', String(split.members));
    }

    return words.join(' ');
  }

  isMainFormInvalid(): boolean {
    return !!(
      this.expenseForm.get('amount')?.invalid ||
      this.expenseForm.get('description')?.invalid ||
      this.expenseForm.get('date')?.invalid ||
      // Ticked but with no usable head count, it would save as something else.
      (this.isSplit && !this.splitPreview)
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
        tzOffset: new Date().getTimezoneOffset(),
        splitMembers: form.split ? Number(form.members) : null
      })
      .subscribe({
        next: expense => {
          this.submitting = false;

          const outcome = expense.status === 'Done'
            ? 'Expense added.'
            : 'Sent to an admin for approval.';

          // The server's figures, which are the ones that were stored.
          this.toast.success(
            expense.splitMembers
              ? `${outcome} Your share ₹${Number(expense.personalShare).toLocaleString()}; ` +
                `₹${Number(expense.splitShare).toLocaleString()} each from the other ` +
                `${expense.splitMembers - 1}.`
              : outcome
          );

          // A budget this expense just carried past 50/80/100% or over.
          for (const alert of expense.budgetAlerts ?? []) {
            this.toast.warning(alert.message);
          }

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
      date: today(),
      split: false,
      members: MIN_SPLIT_MEMBERS
    });

    this.reload();
  }
}
