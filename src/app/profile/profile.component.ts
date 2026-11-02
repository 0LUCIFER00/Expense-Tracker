import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../auth.service';
import { ApiService } from '../shared/api.service';
import { BalanceService } from '../shared/balance.service';
import { ExpenseService, UNCATEGORISED } from '../shared/expense.service';
import { SettingsService } from '../shared/settings.service';
import { WhatsappService, WhatsappLinkStatus } from '../shared/whatsapp.service';
import { Expense, SessionUser } from '../shared/models';
import { downloadCsv } from '../shared/csv';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css'
})
export class ProfileComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly expenseService = inject(ExpenseService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly whatsappService = inject(WhatsappService);

  user: SessionUser | null = null;
  isAdminSession = false;

  /** A summary of the account, not a second copy of the dashboard. */
  totalExpenses = 0;
  accountCount = 0;
  canSeeBalances = false;

  whatsapp: WhatsappLinkStatus | null = null;

  /** Every expense, kept for the CSV download. */
  private expenses: Expense[] = [];

  nameDraft = '';
  emailDraft = '';
  detailsBusy = false;
  detailsError = '';

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  passwordBusy = false;
  passwordError = '';

  exportBusy = false;

  showDeletePopup = false;
  deletePassword = '';
  deleteBusy = false;
  deleteError = '';

  /** One place for "that worked", cleared whenever something else starts. */
  successMessage = '';

  loadError = '';

  get initials(): string {
    const parts = (this.user?.name ?? '').trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return '?';
    }

    const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];

    return letters.toUpperCase();
  }

  /** Nothing to save until one of the two fields actually differs. */
  get detailsChanged(): boolean {
    return (
      this.nameDraft.trim() !== (this.user?.name ?? '') ||
      this.emailDraft.trim().toLowerCase() !== (this.user?.email ?? '')
    );
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
      this.applySession(session?.user ?? null);
      this.isAdminSession = session?.loginType === 'admin';
    });

    forkJoin({
      expenses: this.expenseService.list(),
      balances: this.balanceService.list(),
      settings: this.settingsService.load(true),
      // The page is still worth showing if this one fails.
      whatsapp: this.whatsappService.status().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ expenses, balances, whatsapp }) => {
        this.expenses = expenses;
        this.totalExpenses = expenses.length;
        this.accountCount = balances.filter(account => account.saved).length;
        this.canSeeBalances = this.settingsService.canSeeBalances;
        this.whatsapp = whatsapp;
      },
      error: error => {
        this.loadError = error.message;
      }
    });
  }

  private applySession(user: SessionUser | null): void {
    this.user = user;
    this.nameDraft = user?.name ?? '';
    this.emailDraft = user?.email ?? '';
  }

  onSaveDetails(): void {
    const name = this.nameDraft.trim();
    const email = this.emailDraft.trim().toLowerCase();

    if (name.length < 3) {
      this.detailsError = 'Name must be at least 3 characters';
      return;
    }

    this.detailsBusy = true;
    this.detailsError = '';
    this.successMessage = '';

    this.api.patch<{ user: SessionUser }>('/auth/profile', { name, email }).subscribe({
      next: () => {
        // Re-read rather than patching the cached copy, so the header and
        // anything else reading the session see the new details too.
        this.auth.refreshSession().subscribe(session => {
          this.applySession(session?.user ?? this.user);
          this.detailsBusy = false;
          this.successMessage = 'Details updated.';
        });
      },
      error: error => {
        this.detailsBusy = false;
        this.detailsError = error.message;
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

  /** Everything, rather than the filtered view the expenses page exports. */
  onDownloadData(): void {
    if (!this.expenses.length) {
      return;
    }

    this.exportBusy = true;

    const headers = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Status', 'Remarks'];

    const rows = this.expenses.map(expense => [
      expense.date,
      String(expense.amount),
      expense.description,
      expense.category ?? UNCATEGORISED,
      expense.sourceCategory ?? '',
      expense.status,
      expense.remarks ?? ''
    ]);

    downloadCsv(`expense-tracker-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);

    this.exportBusy = false;
    this.successMessage = 'Downloaded.';
  }

  onAskDelete(): void {
    this.deletePassword = '';
    this.deleteError = '';
    this.successMessage = '';
    this.showDeletePopup = true;
  }

  onCancelDelete(): void {
    this.showDeletePopup = false;
    this.deletePassword = '';
    this.deleteError = '';
  }

  onConfirmDelete(): void {
    if (!this.deletePassword || this.deleteBusy) {
      return;
    }

    this.deleteBusy = true;
    this.deleteError = '';

    this.api.delete('/auth/account', { password: this.deletePassword }).subscribe({
      next: () => {
        // The session cookie is already cleared server-side; drop the cached
        // copies too so nothing tries to render for an account that is gone.
        this.settingsService.reset();
        this.auth.refreshSession().subscribe(() => {
          this.deleteBusy = false;
          this.router.navigate(['/login']);
        });
      },
      error: error => {
        this.deleteBusy = false;
        this.deleteError = error.message;
      }
    });
  }
}
