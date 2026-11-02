import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../auth.service';
import { ApiService } from '../shared/api.service';
import { BalanceService } from '../shared/balance.service';
import { ExpenseService } from '../shared/expense.service';
import { SettingsService } from '../shared/settings.service';
import { SessionUser } from '../shared/models';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css', './profile.component.dark.css']
})
export class ProfileComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);

  user: SessionUser | null = null;
  isAdminSession = false;

  /** A summary of the account, not a second copy of the dashboard. */
  totalExpenses = 0;
  totalSpent = 0;
  accountCount = 0;
  canSeeBalances = false;

  /** Bound to the name field; reset back to the saved name on cancel. */
  editingName = false;
  nameDraft = '';
  nameBusy = false;
  nameError = '';

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  passwordBusy = false;
  passwordError = '';

  /** One place for "that worked", cleared whenever something else starts. */
  successMessage = '';

  loading = true;
  loadError = '';

  get initials(): string {
    const parts = (this.user?.name ?? '').trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return '?';
    }

    const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];

    return letters.toUpperCase();
  }

  get passwordsMatch(): boolean {
    return this.newPassword === this.confirmPassword;
  }

  get canSubmitPassword(): boolean {
    return (
      !this.passwordBusy &&
      this.currentPassword.length > 0 &&
      this.newPassword.length >= 6 &&
      this.passwordsMatch
    );
  }

  ngOnInit(): void {
    this.auth.ensureSession().subscribe(session => {
      this.user = session?.user ?? null;
      this.isAdminSession = session?.loginType === 'admin';
      this.nameDraft = this.user?.name ?? '';
    });

    forkJoin({
      expenses: this.expenseService.list(),
      balances: this.balanceService.list(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ expenses, balances }) => {
        this.totalExpenses = expenses.length;
        this.totalSpent = this.expenseService.totalOf(expenses);
        this.accountCount = balances.filter(account => account.saved).length;
        this.canSeeBalances = this.settingsService.canSeeBalances;
        this.loading = false;
      },
      error: error => {
        this.loadError = error.message;
        this.loading = false;
      }
    });
  }

  onEditName(): void {
    this.nameDraft = this.user?.name ?? '';
    this.nameError = '';
    this.successMessage = '';
    this.editingName = true;
  }

  onCancelName(): void {
    this.editingName = false;
    this.nameDraft = this.user?.name ?? '';
    this.nameError = '';
  }

  onSaveName(): void {
    const name = this.nameDraft.trim();

    if (name.length < 3) {
      this.nameError = 'Name must be at least 3 characters';
      return;
    }

    if (name === this.user?.name) {
      this.editingName = false;
      return;
    }

    this.nameBusy = true;
    this.nameError = '';

    this.api.patch<{ user: SessionUser }>('/auth/profile', { name }).subscribe({
      next: () => {
        // Re-read rather than patching the cached copy, so the header and
        // anything else reading the session see the new name too.
        this.auth.refreshSession().subscribe(session => {
          this.user = session?.user ?? this.user;
          this.nameBusy = false;
          this.editingName = false;
          this.successMessage = 'Name updated.';
        });
      },
      error: error => {
        this.nameBusy = false;
        this.nameError = error.message;
      }
    });
  }

  onChangePassword(): void {
    if (!this.canSubmitPassword) {
      return;
    }

    this.passwordBusy = true;
    this.passwordError = '';
    this.successMessage = '';

    this.api
      .put('/auth/password', {
        currentPassword: this.currentPassword,
        newPassword: this.newPassword
      })
      .subscribe({
        next: () => {
          this.passwordBusy = false;
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmPassword = '';
          this.successMessage = 'Password changed. It applies the next time you sign in.';
        },
        error: error => {
          this.passwordBusy = false;
          this.passwordError = error.message;
        }
      });
  }
}
