import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BalanceService } from '../shared/balance.service';
import { IncomeService } from '../shared/income.service';
import { SettingsService } from '../shared/settings.service';
import { BalanceAccount, Income } from '../shared/models';
import { today } from '../shared/date-utils';
import { FitsScreenDirective } from '../shared/fits-screen.directive';
import { ToastService } from '../shared/toast.service';

/**
 * Add Money — the mirror of Add Expense.
 *
 * Before this the only way to raise a balance was to edit the figure on the
 * accounts page, which left no record of where the money came from. This
 * records it and credits the account together.
 */
@Component({
  selector: 'app-add-money',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterModule, FitsScreenDirective],
  templateUrl: './add-money.component.html',
  styleUrl: './add-money.component.css'
})
export class AddMoneyComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly incomeService = inject(IncomeService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);

  moneyForm: FormGroup = this.fb.group({
    target: ['', Validators.required],
    category: [''],
    amount: ['', [Validators.required, Validators.min(1), Validators.max(100000)]],
    description: ['', Validators.required],
    date: [today(), Validators.required]
  });

  accounts: BalanceAccount[] = [];
  categories: string[] = [];
  recent: Income[] = [];

  canUpdateBalance = false;
  canSeeBalances = false;

  submitting = false;

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    forkJoin({
      balances: this.balanceService.list(),
      categories: this.incomeService.listCategories(),
      incomes: this.incomeService.list(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ balances, categories, incomes }) => {
        this.accounts = balances.filter(account => account.saved);
        this.categories = categories;
        this.recent = incomes.slice(0, 6);

        this.canUpdateBalance = this.settingsService.canUpdateBalance;
        this.canSeeBalances = this.settingsService.canSeeBalances;

        const target = this.moneyForm.get('target');

        if (this.canUpdateBalance) {
          target?.enable();
        } else {
          target?.disable();
          target?.setValue('');
        }
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  /** The account chosen under "Add to", or null while none is. */
  get selectedAccount(): BalanceAccount | null {
    const id = this.moneyForm.get('target')?.value;

    return id ? this.accounts.find(account => account.id === id) ?? null : null;
  }

  /** What that account would hold once this money is in. */
  get balanceAfter(): number | null {
    const account = this.selectedAccount;
    const amount = Number(this.moneyForm.get('amount')?.value);

    if (!account || account.balance === null || !Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    return Math.round((Number(account.balance) + amount) * 100) / 100;
  }

  /** A WhatsApp message that would file what is being typed. */
  get sampleCommand(): string {
    const amount = Number(this.moneyForm.get('amount')?.value);
    const description = String(this.moneyForm.get('description')?.value ?? '').trim();

    const words = [
      '+' + (Number.isFinite(amount) && amount > 0 ? String(amount) : '50000'),
      description ? description.split(/\s+/)[0].toLowerCase() : 'salary'
    ];

    const account = this.selectedAccount;

    if (account) {
      words.push(account.category.split(/\s+/)[0].toLowerCase());
    }

    return words.join(' ');
  }

  onPickCategory(name: string): void {
    this.moneyForm.get('category')?.setValue(name);
  }

  get isInvalid(): boolean {
    return this.moneyForm.invalid;
  }

  onSubmit(): void {
    if (this.isInvalid || this.submitting) {
      return;
    }

    const form = this.moneyForm.getRawValue();

    this.submitting = true;

    this.incomeService
      .create({
        amount: Number(form.amount),
        description: form.description,
        date: form.date,
        category: form.category || null,
        targetId: String(form.target)
      })
      .subscribe({
        next: added => {
          this.submitting = false;

          this.toast.success(
            added.balanceAfter === null
              ? 'Money added.'
              // Grouped, so it reads the same as every other figure on screen.
              : `Money added. ${added.targetCategory} now ` +
                `₹${Number(added.balanceAfter).toLocaleString()}.`
          );

          this.moneyForm.reset({
            target: '',
            category: '',
            amount: '',
            description: '',
            date: today()
          });

          this.reload();
        },
        error: error => {
          this.submitting = false;
          this.toast.error(error.message);
        }
      });
  }
}
