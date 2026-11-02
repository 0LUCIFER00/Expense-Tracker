import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BalanceService } from '../shared/balance.service';
import { BalanceAccount } from '../shared/models';

/**
 * A row on screen. `id` is null until the row has been saved to the server,
 * which is what decides between a create and an update.
 */
interface BalanceRow {
  id: string | null;
  type: string;
  category: string;
  balance: number | null;
  saved: boolean;
  busy: boolean;
}

@Component({
  selector: 'app-bal-mnt',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bal-mnt.component.html',
  styleUrl: './bal-mnt.component.css'
})
export class BalMntComponent implements OnInit, OnDestroy {
  private readonly balanceService = inject(BalanceService);

  popupVisible = false;
  popupValue = '';
  selectedItem: BalanceRow | null = null;

  balances: BalanceRow[] = [this.createBalanceRow()];

  loading = true;
  errorMessage = '';
  toastMessage = '';

  private toastTimeout: ReturnType<typeof setTimeout> | undefined;

  handCashOptions = ['Personal', 'General'];

  walletOptions = ['Google Pay', 'PhonePe', 'Paytm', 'Amazon Pay'];

  bankOptions = [
    'State Bank of India',
    'Indian Bank',
    'Canara Bank',
    'HDFC Bank',
    'ICICI Bank',
    'Axis Bank'
  ];

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimeout);
  }

  private load(): void {
    this.balanceService.list().subscribe({
      next: accounts => {
        this.balances = accounts.length
          ? accounts.map(account => this.toRow(account))
          : [this.createBalanceRow()];

        this.rememberCustomOptions(accounts);
        this.loading = false;
      },
      error: error => {
        this.errorMessage = error.message;
        this.loading = false;
      }
    });
  }

  /** Keeps a saved category selectable even if it was added on another device. */
  private rememberCustomOptions(accounts: BalanceAccount[]): void {
    for (const account of accounts) {
      const options = this.getOptions(account.type);

      if (account.category && !options.includes(account.category)) {
        options.push(account.category);
      }
    }
  }

  private toRow(account: BalanceAccount): BalanceRow {
    return {
      id: account.id,
      type: account.type,
      category: account.category,
      balance: account.balance,
      saved: true,
      busy: false
    };
  }

  createBalanceRow(): BalanceRow {
    return {
      id: null,
      type: 'Hand Cash',
      category: '',
      balance: null,
      saved: false,
      busy: false
    };
  }

  addRow(): void {
    this.balances.push(this.createBalanceRow());
  }

  getOptions(type: string): string[] {
    switch (type) {
      case 'Hand Cash':
        return this.handCashOptions;

      case 'Wallet':
        return this.walletOptions;

      case 'Bank Account':
        return this.bankOptions;

      default:
        return [];
    }
  }

  openAddOptionPopup(item: BalanceRow): void {
    this.selectedItem = item;
    this.popupValue = '';
    this.popupVisible = true;
  }

  saveNewOption(): void {
    const value = this.popupValue.trim();

    if (!value || !this.selectedItem) {
      return;
    }

    const options = this.getOptions(this.selectedItem.type);

    if (!options.includes(value)) {
      options.push(value);
    }

    this.selectedItem.category = value;
    this.selectedItem.saved = false;

    this.popupVisible = false;
    this.popupValue = '';
  }

  onTypeChange(item: BalanceRow): void {
    item.category = '';
  }

  onCategoryChange(item: BalanceRow): void {
    if (item.category === 'other') {
      item.category = '';
      this.openAddOptionPopup(item);
    }
  }

  onBalanceRowChange(item: BalanceRow): void {
    item.saved = false;
  }

  isRowComplete(item: BalanceRow): boolean {
    return Boolean(
      item.type &&
      item.category &&
      item.balance !== null &&
      String(item.balance) !== '' &&
      Number(item.balance) > 0
    );
  }

  saveBalanceRow(item: BalanceRow): void {
    if (!this.isRowComplete(item)) {
      this.showToast('Please fill all fields');
      return;
    }

    const payload = {
      type: item.type,
      category: item.category,
      balance: Number(item.balance)
    };

    item.busy = true;

    const request = item.id
      ? this.balanceService.update(item.id, payload)
      : this.balanceService.create(payload);

    request.subscribe({
      next: saved => {
        item.id = saved.id;
        item.balance = saved.balance;
        item.saved = true;
        item.busy = false;
        this.showToast('Data saved');
      },
      error: error => {
        item.busy = false;
        this.showToast(error.message);
      }
    });
  }

  removeRow(index: number): void {
    const item = this.balances[index];

    const dropLocally = () => {
      this.balances.splice(index, 1);

      if (this.balances.length === 0) {
        this.balances.push(this.createBalanceRow());
      }
    };

    // A row that was never saved only exists on screen.
    if (!item.id) {
      dropLocally();
      return;
    }

    item.busy = true;

    this.balanceService.remove(item.id).subscribe({
      next: () => {
        dropLocally();
        this.showToast('Data deleted');
      },
      error: error => {
        item.busy = false;
        this.showToast(error.message);
      }
    });
  }

  showToast(message: string): void {
    this.toastMessage = message;

    // Without clearing the previous timer, a toast raised within 2s of the last
    // one is wiped out early by the older timeout.
    clearTimeout(this.toastTimeout);

    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
    }, 2000);
  }
}
