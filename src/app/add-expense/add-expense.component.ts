import { CommonModule } from '@angular/common';
import { AttachmentPickerComponent } from '../shared/attachment-picker/attachment-picker.component';
import { Component, OnInit, ViewChild, inject } from '@angular/core';
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
import { dayLabel, openDatePicker, parseLocalDate, today, yesterday } from '../shared/date-utils';
import { categoryIcon } from '../shared/category-icons';
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
    ExpenseDatePopupComponent,
    AttachmentPickerComponent
  ],
  templateUrl: './add-expense.component.html',
  styleUrls: ['../shared/entry-form.css', '../shared/entry-aside.css', './add-expense.component.css']
})
export class AddExpenseComponent implements OnInit {
  /** Receipts chosen before saving; attached once the expense exists. */
  @ViewChild(AttachmentPickerComponent) picker?: AttachmentPickerComponent;

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

  readonly categoryIcon = categoryIcon;

  /** Clicking the chosen category again clears it; a category is optional. */
  pickCategory(name: string): void {
    const control = this.expenseForm.get('category');
    control?.setValue(control.value === name ? '' : name);
  }

  pickSource(id: string): void {
    this.expenseForm.get('source')?.setValue(id);
  }

  toggleSplit(): void {
    const control = this.expenseForm.get('split');
    control?.setValue(!control.value);
  }

  /** The − and + beside the head count, kept within the allowed range. */
  stepMembers(delta: number): void {
    const control = this.expenseForm.get('members');
    const next = Number(control?.value || this.minMembers) + delta;

    control?.setValue(Math.min(this.maxMembers, Math.max(this.minMembers, next)));
  }

  get members(): number {
    return Number(this.expenseForm.get('members')?.value) || this.minMembers;
  }

  // ---- the date: Today, Yesterday, or any other day from the calendar ----

  get todayIso(): string {
    return today();
  }

  get yesterdayIso(): string {
    return yesterday();
  }

  get dateValue(): string {
    return String(this.expenseForm.get('date')?.value ?? '');
  }

  /** True when the date is neither today nor yesterday, so "Pick a date" shows it. */
  get isOtherDate(): boolean {
    return this.dateValue !== this.todayIso && this.dateValue !== this.yesterdayIso;
  }

  pickDate(value: string): void {
    this.expenseForm.get('date')?.setValue(value);
  }

  readonly openCalendar = openDatePicker;

  get dateLabel(): string {
    return dayLabel(this.dateValue);
  }

  get amountValue(): number {
    const amount = Number(this.expenseForm.get('amount')?.value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  /** The share of the account's balance left after this, for the bar on the slip. */
  get keepPercent(): number {
    const account = this.selectedAccount;
    const after = this.balanceAfter;

    if (!account || after === null || !account.balance) {
      return 100;
    }

    return Math.max(0, Math.min(100, (after / Number(account.balance)) * 100));
  }

  /** The names of the receipts waiting to be attached, for the slip. */
  get receiptNames(): string {
    return (this.picker?.items ?? [])
      .filter(item => item.state !== 'error')
      .map(item => item.name)
      .join(', ');
  }

  /** The account chosen under "Pay from", or null while none is. */
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

          this.attachReceipts(expense.id);
        },
        error: error => {
          this.submitting = false;
          this.toast.error(error.message);
        }
      });
  }

  /**
   * Sends any receipts chosen for this expense, now that it exists. The
   * expense is saved either way; a file that fails is reported and stays
   * listed, and can be attached later from Transactions.
   */
  private async attachReceipts(expenseId: string): Promise<void> {
    const picker = this.picker;

    if (!picker || picker.waiting === 0) {
      this.submitting = false;
      this.resetForm();
      return;
    }

    this.submitting = true;
    const { sent, failed } = await picker.uploadAll(expenseId);
    this.submitting = false;

    if (sent) {
      this.toast.success(`${sent} ${sent === 1 ? 'receipt' : 'receipts'} attached.`);
    }

    if (failed) {
      this.toast.error(
        `${failed} ${failed === 1 ? 'file was' : 'files were'} not attached; see the list. ` +
        'The expense is saved, and you can attach them from Transactions.'
      );
      this.resetForm({ keepReceipts: true });
      return;
    }

    this.resetForm();
  }

  private resetForm({ keepReceipts = false } = {}): void {
    if (!keepReceipts) {
      this.picker?.clear();
    }

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
