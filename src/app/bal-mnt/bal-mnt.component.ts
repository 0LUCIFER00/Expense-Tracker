import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UserService } from '../shared/user.service';

@Component({
  selector: 'app-bal-mnt',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bal-mnt.component.html',
  styleUrl: './bal-mnt.component.css'
})
export class BalMntComponent {

  popupVisible = false;
  popupValue = '';
  selectedItem: any = null;

  currentUserName = '';

  ngOnInit() {

    const savedBalances = localStorage.getItem('balances');

    if (savedBalances) {
      const parsedBalances = JSON.parse(savedBalances);

      this.balances = parsedBalances.length > 0
        ? parsedBalances
        : [this.createBalanceRow()];
    }
  }

  constructor(private router: Router, private userService: UserService) { }





  balances = [
    this.createBalanceRow()
  ];

  createBalanceRow() {
    return {
      id: Date.now() + Math.random(),
      type: 'Hand Cash',
      category: '',
      balance: null,
      saved: false
    };
  }

  toastMessage = '';


  handCashOptions = [
    'Personal',
    'General'
  ];

  walletOptions = [
    'Google Pay',
    'PhonePe',
    'Paytm',
    'Amazon Pay'
  ];

  bankOptions = [
    'State Bank of India',
    'Indian Bank',
    'Canara Bank',
    'HDFC Bank',
    'ICICI Bank',
    'Axis Bank'
  ];

  customOption = '';

  addRow() {
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

  openAddOptionPopup(item: any) {
    this.selectedItem = item;
    this.popupValue = '';
    this.popupVisible = true;
  }

  saveNewOption() {

    if (!this.popupValue.trim()) {
      return;
    }

    switch (this.selectedItem.type) {

      case 'Hand Cash':
        this.handCashOptions.push(this.popupValue);
        break;

      case 'Wallet':
        this.walletOptions.push(this.popupValue);
        break;

      case 'Bank Account':
        this.bankOptions.push(this.popupValue);
        break;
    }

    this.selectedItem.category = this.popupValue;

    this.popupVisible = false;
    this.popupValue = '';
  }

  onTypeChange(item: any) {
    item.category = '';
  }

  onCategoryChange(item: any) {

    if (item.category === 'other') {
      this.openAddOptionPopup(item);
    }

  }

  addCustomOption(item: any) {

    if (!this.customOption.trim()) {
      return;
    }

    switch (item.type) {

      case 'Hand Cash':
        this.handCashOptions.push(this.customOption);
        break;

      case 'Wallet':
        this.walletOptions.push(this.customOption);
        break;

      case 'Bank Account':
        this.bankOptions.push(this.customOption);
        break;
    }

    item.category = this.customOption;
    this.customOption = '';
  }

  onBalanceRowChange(item: any) {
    item.saved = false;
  }

  saveBalanceRow(item: any) {

  if (
    !item.type ||
    !item.category ||
    item.balance === null ||
    item.balance === '' ||
    item.balance <= 0
  ) {
    this.showToast('Please fill all fields');
    return;
  }

  item.saved = true;

  let savedBalances = JSON.parse(
    localStorage.getItem('balances') || '[]'
  );

  const index = savedBalances.findIndex(
    (row: any) => row.id === item.id
  );

  if (index !== -1) {
    savedBalances[index] = item;
  } else {
    savedBalances.push(item);
  }

  localStorage.setItem(
    'balances',
    JSON.stringify(savedBalances)
  );

  this.showToast('Data saved');
}

  removeRow(index: number) {
  const deletedItem = this.balances[index];

  this.balances.splice(index, 1);

  let savedBalances = JSON.parse(
    localStorage.getItem('balances') || '[]'
  );

  savedBalances = savedBalances.filter(
    (row: any) => row.id !== deletedItem.id
  );

  localStorage.setItem('balances', JSON.stringify(savedBalances));

  if (this.balances.length === 0) {
    this.balances.push(this.createBalanceRow());
  }

  this.showToast('Data deleted');
}

  showToast(message: string) {
    this.toastMessage = message;

    setTimeout(() => {
      this.toastMessage = '';
    }, 2000);
  }

}