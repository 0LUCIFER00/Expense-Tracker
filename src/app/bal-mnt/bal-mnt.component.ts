import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BalanceService } from '../shared/balance.service';
import { AccountUsage, BalanceAccount, TransferResult } from '../shared/models';
import { SettingsService } from '../shared/settings.service';
import { ToastService } from '../shared/toast.service';
import { TransferFormComponent } from './transfer-form/transfer-form.component';
import { TransferHistoryComponent } from './transfer-history/transfer-history.component';

type AccountType = 'Hand Cash' | 'Wallet' | 'Bank Account';

/**
 * Cash & Accounts: the accounts as cards at the top, Transfer money under
 * them, and the transfer history below.
 *
 * Accounts are added here and removed here, never edited: a figure is changed
 * by recording what happened (an expense, income or a transfer), so there is
 * always a record of why. Removing an account is refused, with the reasons,
 * while it holds money or has history.
 */
@Component({
  selector: 'app-bal-mnt',
  standalone: true,
  imports: [FormsModule, RouterModule, DecimalPipe, TransferFormComponent, TransferHistoryComponent],
  templateUrl: './bal-mnt.component.html',
  styleUrl: './bal-mnt.component.css'
})
export class BalMntComponent implements OnInit {
  private readonly balanceService = inject(BalanceService);
  private readonly toast = inject(ToastService);
  private readonly settingsService = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);

  /**
   * The account a link asked for (?account=<id>), from a lending record for
   * one: outlined and scrolled to once the accounts arrive.
   */
  focusId: string | null = null;

  /**
   * Seeing balances without "Debit from an account": the figures are shown but
   * cannot be changed, which the API enforces too.
   */
  get readOnly(): boolean {
    return !this.settingsService.canManageBalances;
  }

  get canBackdate(): boolean {
    return this.settingsService.canBackdate;
  }

  accounts: BalanceAccount[] = [];
  loading = true;

  /** Bumped after a transfer so the history reloads. */
  refresh = 0;

  /* ---- adding an account ---- */
  adding = false;
  newType: AccountType = 'Bank Account';
  newCategory = '';
  newBalance: number | null = null;
  saving = false;

  popupVisible = false;
  popupValue = '';

  readonly typeLabels: Record<AccountType, string> = {
    'Hand Cash': 'Cash in hand',
    Wallet: 'Wallet',
    'Bank Account': 'Bank Account'
  };

  handCashOptions = ['Personal', 'General'];
  walletOptions = ['Google Pay', 'PhonePe', 'Paytm', 'Amazon Pay'];
  bankOptions = ['State Bank of India', 'Indian Bank', 'Canara Bank', 'HDFC Bank', 'ICICI Bank', 'Axis Bank'];

  /* ---- removing an account ---- */
  confirmTarget: BalanceAccount | null = null;
  usage: AccountUsage | null = null;
  usageError = '';
  deleting = false;

  get total(): number {
    return this.accounts.reduce((sum, a) => sum + Math.round(Number(a.balance ?? 0) * 100), 0) / 100;
  }

  ngOnInit(): void {
    this.focusId = this.route.snapshot.queryParamMap.get('account');
    this.load();
  }

  /** Brings the asked-for account into view, after it has rendered. */
  private scrollToFocus(): void {
    if (!this.focusId || !this.accounts.some(a => a.id === this.focusId)) {
      this.focusId = null;
      return;
    }

    setTimeout(() => document.getElementById(`acct-${this.focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  private load(): void {
    this.balanceService.list().subscribe({
      next: accounts => {
        this.accounts = accounts.filter(a => a.saved);
        this.rememberCustomOptions(this.accounts);
        this.adding = this.accounts.length === 0 && !this.readOnly;
        this.loading = false;
        this.scrollToFocus();
      },
      error: error => {
        this.toast.error(error.message);
        this.loading = false;
      }
    });
  }

  /** Keeps a name added on another device selectable here. */
  private rememberCustomOptions(accounts: BalanceAccount[]): void {
    for (const account of accounts) {
      const options = this.getOptions(account.type);

      if (account.category && !options.includes(account.category)) {
        options.push(account.category);
      }
    }
  }

  getOptions(type: string): string[] {
    switch (type) {
      case 'Hand Cash': return this.handCashOptions;
      case 'Wallet': return this.walletOptions;
      case 'Bank Account': return this.bankOptions;
      default: return [];
    }
  }

  typeLabel(type: string): string {
    return (this.typeLabels as Record<string, string>)[type] ?? type;
  }

  nameLabel(type: string): string {
    return type === 'Hand Cash' ? 'Cash type' : type === 'Wallet' ? 'Wallet name' : 'Bank name';
  }

  /** Bank, wallet or cash, for the card's icon. */
  kind(type: string): 'bank' | 'wallet' | 'cash' {
    return type === 'Wallet' ? 'wallet' : type === 'Hand Cash' ? 'cash' : 'bank';
  }

  /* ---- transfers ---- */

  /** Shows the new balances straight away and reloads the history. */
  onTransferred(result: TransferResult): void {
    const balances: Record<string, number> = {
      [result.transfer.fromAccountId]: result.fromBalance,
      [result.transfer.toAccountId]: result.toBalance
    };

    this.accounts = this.accounts.map(a => a.id in balances ? { ...a, balance: balances[a.id] } : a);
    this.refresh += 1;
  }

  /* ---- adding ---- */

  startAdding(): void {
    this.adding = true;
    this.newType = 'Bank Account';
    this.newCategory = '';
    this.newBalance = null;
  }

  cancelAdding(): void {
    this.adding = false;
  }

  onTypeChange(): void {
    this.newCategory = '';
  }

  onCategoryChange(): void {
    if (this.newCategory === 'other') {
      this.newCategory = '';
      this.popupValue = '';
      this.popupVisible = true;
    }
  }

  saveNewOption(): void {
    const value = this.popupValue.trim();

    if (!value) {
      return;
    }

    const options = this.getOptions(this.newType);

    if (!options.includes(value)) {
      options.push(value);
    }

    this.newCategory = value;
    this.popupVisible = false;
  }

  get canSaveNew(): boolean {
    const balance = Number(this.newBalance ?? 0);
    return Boolean(this.newCategory) && balance >= 0 && Number.isFinite(balance);
  }

  saveNew(): void {
    if (!this.canSaveNew) {
      this.toast.error('Choose a name, and an opening balance of zero or more.');
      return;
    }

    this.saving = true;

    this.balanceService.create({
      type: this.newType,
      category: this.newCategory,
      balance: Number(this.newBalance ?? 0)
    }).subscribe({
      next: account => {
        this.saving = false;
        this.adding = false;
        this.accounts = [...this.accounts, account];
        this.toast.success(`${account.category} added.`);
      },
      error: error => {
        this.saving = false;
        this.toast.error(error.message);
      }
    });
  }

  /* ---- removing ---- */

  /** Asks the server first whether it can go, so the dialog can say why not. */
  askRemove(account: BalanceAccount): void {
    this.confirmTarget = account;
    this.usage = null;
    this.usageError = '';

    this.balanceService.usage(account.id).subscribe({
      next: usage => {
        if (this.confirmTarget?.id === account.id) {
          this.usage = usage;
        }
      },
      error: error => {
        this.usageError = error.message;
      }
    });
  }

  cancelRemove(): void {
    this.confirmTarget = null;
    this.usage = null;
  }

  confirmRemove(): void {
    const account = this.confirmTarget;

    if (!account || !this.usage?.deletable) {
      return;
    }

    this.deleting = true;

    this.balanceService.remove(account.id).subscribe({
      next: () => {
        this.deleting = false;
        this.confirmTarget = null;
        this.accounts = this.accounts.filter(a => a.id !== account.id);
        this.toast.success(`${account.category} deleted.`);
      },
      error: error => {
        this.deleting = false;
        // Something changed since the check (money arrived, say): show why.
        this.usageError = error.message;
      }
    });
  }
}
