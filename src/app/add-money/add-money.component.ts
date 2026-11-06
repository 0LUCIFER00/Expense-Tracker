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
import { ExpenseService } from '../shared/expense.service';
import { IncomeService } from '../shared/income.service';
import { SettingsService } from '../shared/settings.service';
import { BalanceAccount, Income, SplitSummary } from '../shared/models';
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
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);

  moneyForm: FormGroup = this.fb.group({
    target: ['', Validators.required],
    category: [''],
    amount: ['', [Validators.required, Validators.min(1), Validators.max(100000)]],
    description: ['', Validators.required],
    date: [today(), Validators.required],
    // The split expense this pays back part of; empty for ordinary money in.
    splitFor: ['']
  });

  accounts: BalanceAccount[] = [];
  categories: string[] = [];
  recent: Income[] = [];
  /** Splits somebody still owes something on — the only ones worth offering. */
  openSplits: SplitSummary[] = [];

  canUpdateBalance = false;
  canSeeBalances = false;
  /** Off: the date stays on today, as the API requires. */
  canBackdate = false;

  submitting = false;

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    forkJoin({
      balances: this.balanceService.list(),
      categories: this.incomeService.listCategories(),
      incomes: this.incomeService.list(),
      splits: this.expenseService.listSplits(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ balances, categories, incomes, splits }) => {
        this.accounts = balances.filter(account => account.saved);
        this.categories = categories;
        // The latest three, as on Home; Transactions has the rest.
        this.recent = incomes.slice(0, 3);
        this.openSplits = splits.filter(split => split.remaining > 0);

        // Shown either way so it can be found, but only choosable when there
        // is something to choose.
        const splitFor = this.moneyForm.get('splitFor');

        if (this.openSplits.length) {
          splitFor?.enable();
        } else {
          splitFor?.setValue('');
          splitFor?.disable();
        }

        this.canUpdateBalance = this.settingsService.canUpdateBalance;
        this.canSeeBalances = this.settingsService.canSeeBalances;
        this.canBackdate = this.settingsService.canBackdate;

        // Another day needs "Change transaction dates"; the API refuses it too.
        const date = this.moneyForm.get('date');

        if (this.canBackdate) {
          date?.enable();
        } else {
          date?.setValue(today());
          date?.disable();
        }

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

  /** The split being paid back, or null for ordinary money in. */
  get selectedSplit(): SplitSummary | null {
    const id = this.moneyForm.get('splitFor')?.value;

    return id ? this.openSplits.find(split => split.id === id) ?? null : null;
  }

  /**
   * Choosing a split fills in what is usually true of a repayment — one
   * person's share, labelled with what it was for — but only where nothing has
   * been typed yet, so it never overwrites the user.
   */
  onSplitChange(): void {
    const split = this.selectedSplit;
    const category = this.moneyForm.get('category');

    if (!split) {
      category?.enable();
      return;
    }

    const amount = this.moneyForm.get('amount');
    const description = this.moneyForm.get('description');

    if (!amount?.value) {
      amount?.setValue(String(Math.min(split.share, split.remaining)));
    }

    if (!description?.value) {
      description?.setValue(`${split.description} share`);
    }

    // A repayment is not income from anywhere, so it is not filed under one.
    // Disabled rather than hidden, so the row beside it does not jump.
    category?.setValue('');
    category?.disable();
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

    const split = this.selectedSplit;

    // A repayment is matched to its split by a word of the split's name, and
    // marked by "share" — the last word of a name is usually the telling one.
    const words = split
      ? [
          '+' + (Number.isFinite(amount) && amount > 0 ? String(amount) : String(split.share)),
          split.description.split(/\s+/).pop()!.toLowerCase(),
          'share'
        ]
      : [
          '+' + (Number.isFinite(amount) && amount > 0 ? String(amount) : '50000'),
          description ? description.split(/\s+/)[0].toLowerCase() : 'salary'
        ];

    const account = this.selectedAccount;

    if (account) {
      words.push(account.category.split(/\s+/)[0].toLowerCase());
    }

    return words.join(' ');
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
        category: form.splitFor ? null : form.category || null,
        targetId: String(form.target),
        splitExpenseId: form.splitFor || null,
        tzOffset: new Date().getTimezoneOffset()
      })
      .subscribe({
        next: added => {
          this.submitting = false;

          const rupees = (value: number) => `₹${Number(value).toLocaleString()}`;

          const balance = added.balanceAfter === null
            ? ''
            // Grouped, so it reads the same as every other figure on screen.
            : ` ${added.targetCategory} now ${rupees(added.balanceAfter)}.`;

          const towards = added.split
            ? added.split.remaining > 0
              ? ` ${rupees(added.split.received)} of ${rupees(added.split.owed)} back, ` +
                `${rupees(added.split.remaining)} still to come.`
              : ` All ${rupees(added.split.owed)} paid back.`
            : '';

          this.toast.success(
            `${added.split ? 'Repayment recorded.' : 'Income added.'}${towards}${balance}`
          );

          this.moneyForm.reset({
            target: '',
            category: '',
            amount: '',
            description: '',
            date: today(),
            splitFor: ''
          });

          // A repayment left it disabled; the next entry starts from ordinary.
          this.moneyForm.get('category')?.enable();

          this.reload();
        },
        error: error => {
          this.submitting = false;
          this.toast.error(error.message);
        }
      });
  }
}
