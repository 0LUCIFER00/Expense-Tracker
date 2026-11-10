import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BalanceService } from '../shared/balance.service';
import { FitsScreenDirective } from '../shared/fits-screen.directive';
import { initialsOf } from '../shared/initials';
import { LOAN_STATUS_LABELS, LoansService, loanDate, newRequestId } from '../shared/loans.service';
import {
  BalanceAccount, Loan, LoanDirection, LoanDraft, LoanQuote, LoanRepayment, LoanStatus, LoansOverview
} from '../shared/models';
import { ToastService } from '../shared/toast.service';
import { LoanEditorComponent } from './loan-editor/loan-editor.component';
import { RepaymentFormComponent, RepaymentSave } from './repayment-form/repayment-form.component';

export type LoansTab = 'lent' | 'borrowed' | 'history';

/** The filters over the list: a person, a status, an account and a date range. */
export interface LoanFilters {
  person: string;
  status: '' | LoanStatus;
  account: string;
  from: string;
  to: string;
}

const NO_FILTERS: LoanFilters = { person: '', status: '', account: '', from: '', to: '' };

/**
 * Lending & Borrowing: money given to people and money received from them.
 *
 * The principal moves a real account but is never spending or income; only
 * interest is, and the server files it as an ordinary entry. Every figure on
 * this page (owed, repaid, interest, status) comes from the API.
 */
@Component({
  selector: 'app-loans',
  standalone: true,
  imports: [DecimalPipe, FormsModule, NgTemplateOutlet, RouterLink, FitsScreenDirective, LoanEditorComponent, RepaymentFormComponent],
  templateUrl: './loans.component.html',
  styleUrls: ['./loans.component.css', './loans-detail.css']
})
export class LoansComponent implements OnInit {
  private readonly loans = inject(LoansService);
  private readonly balances = inject(BalanceService);
  private readonly toast = inject(ToastService);

  @ViewChild('detail') detailEl?: ElementRef<HTMLElement>;

  view: LoansOverview | null = null;
  accounts: BalanceAccount[] = [];
  loading = true;
  loadError = '';
  busy = false;

  tab: LoansTab = 'lent';
  filters: LoanFilters = { ...NO_FILTERS };
  selectedId: string | null = null;

  /** The record editor: new (with a direction) or changing one. */
  editorOpen = false;
  editorDirection: LoanDirection = 'lent';
  editing: Loan | null = null;
  editorError = '';
  private editorRequestId = newRequestId();

  /** The repayment form, and what is owed on its date. */
  repayFor: Loan | null = null;
  quote: LoanQuote | null = null;
  repayError = '';
  private repayRequestId = newRequestId();

  confirmCancel: Loan | null = null;
  cancelReason = '';
  confirmReverse: { loan: Loan; repayment: LoanRepayment } | null = null;

  readonly statusLabels = LOAN_STATUS_LABELS;
  readonly loanDate = loanDate;
  readonly initials = initialsOf;

  readonly statuses: { value: '' | LoanStatus; label: string }[] = [
    { value: '', label: 'Any status' },
    ...(['active', 'partial', 'overdue', 'completed', 'cancelled'] as LoanStatus[]).map(value => ({ value, label: LOAN_STATUS_LABELS[value] }))
  ];

  get today(): string {
    return this.view?.today ?? '';
  }

  get canManage(): boolean {
    return this.view?.canManage ?? false;
  }

  get canBackdate(): boolean {
    return this.view?.canBackdate ?? false;
  }

  get filtered(): boolean {
    return Object.entries(this.filters).some(([key, value]) => value !== NO_FILTERS[key as keyof LoanFilters]);
  }

  /** The accounts any record or repayment used, plus the saved ones, for the account filter. */
  get accountOptions(): { id: string; name: string }[] {
    const names = new Map<string, string>(this.accounts.map(a => [a.id, a.category]));

    for (const l of this.view?.loans ?? []) names.set(l.accountId, names.get(l.accountId) ?? l.accountName);
    for (const r of this.view?.repayments ?? []) names.set(r.accountId, names.get(r.accountId) ?? r.accountName);

    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  count(tab: LoansTab): number {
    if (!this.view) return 0;
    return tab === 'history' ? this.view.repayments.length : this.view.loans.filter(l => l.direction === tab).length;
  }

  private matchesPerson(...texts: (string | null | undefined)[]): boolean {
    const needle = this.filters.person.trim().toLowerCase();
    return !needle || texts.some(t => (t ?? '').toLowerCase().includes(needle));
  }

  private inRange(date: string): boolean {
    return (!this.filters.from || date >= this.filters.from) && (!this.filters.to || date <= this.filters.to);
  }

  /** The records on the tab, with the filters applied; overdue and open first, then newest. */
  get shown(): Loan[] {
    if (!this.view || this.tab === 'history') return [];
    const f = this.filters;
    const order: Record<LoanStatus, number> = { overdue: 0, partial: 1, active: 1, completed: 2, cancelled: 3 };

    return this.view.loans
      .filter(l => l.direction === this.tab)
      .filter(l => this.matchesPerson(l.personName, l.contact, l.notes))
      .filter(l => !f.status || l.status === f.status)
      .filter(l => !f.account || l.accountId === f.account || this.repaymentsFor(l).some(r => r.accountId === f.account))
      .filter(l => this.inRange(l.date))
      .sort((a, b) => order[a.status] - order[b.status] || b.date.localeCompare(a.date));
  }

  /** Every repayment, newest first, with the filters applied. */
  get history(): LoanRepayment[] {
    if (!this.view) return [];
    const f = this.filters;
    const statusOf = new Map(this.view.loans.map(l => [l.id, l.status]));

    return this.view.repayments
      .filter(r => this.matchesPerson(r.personName, r.note))
      .filter(r => !f.status || statusOf.get(r.loanId) === f.status)
      .filter(r => !f.account || r.accountId === f.account)
      .filter(r => this.inRange(r.date));
  }

  get selected(): Loan | null {
    return this.view?.loans.find(l => l.id === this.selectedId) ?? null;
  }

  repaymentsFor(loan: Loan): LoanRepayment[] {
    return (this.view?.repayments ?? []).filter(r => r.loanId === loan.id);
  }

  /** Only the latest repayment still standing can be reversed. */
  latestActive(loan: Loan): LoanRepayment | null {
    return this.repaymentsFor(loan).find(r => !r.reversed) ?? null;
  }

  /** How much of the principal has come back, for the bar. */
  repaidPercent(loan: Loan): number {
    return loan.principal > 0 ? Math.min(100, Math.round((loan.principalRepaid / loan.principal) * 100)) : 0;
  }

  tone(status: LoanStatus): string {
    return { active: 'info', partial: 'warn', completed: 'ok', overdue: 'bad', cancelled: 'muted' }[status];
  }

  fmt(value: number): string {
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  ngOnInit(): void {
    this.load();
  }

  /** The records and the accounts, together: every save changes a balance. */
  load(selectId: string | null = this.selectedId): void {
    this.loading = true;

    forkJoin({ view: this.loans.overview(), accounts: this.balances.list() }).subscribe({
      next: ({ view, accounts }) => {
        this.view = view;
        this.accounts = accounts.filter(a => a.saved);
        this.loading = false;
        this.loadError = '';
        this.selectedId = view.loans.some(l => l.id === selectId) ? selectId : this.firstOnTab();
      },
      error: error => {
        this.loading = false;
        this.loadError = error.message || 'Lending & Borrowing could not be loaded.';
      }
    });
  }

  private firstOnTab(): string | null {
    return this.shown[0]?.id ?? null;
  }

  setTab(tab: LoansTab): void {
    this.tab = tab;

    if (tab !== 'history' && !this.shown.some(l => l.id === this.selectedId)) {
      this.selectedId = this.firstOnTab();
    }
  }

  clearFilters(): void {
    this.filters = { ...NO_FILTERS };
  }

  select(loan: Loan): void {
    this.selectedId = loan.id;

    // On a phone the details are under the list.
    if (window.matchMedia?.('(max-width: 999px)').matches) {
      setTimeout(() => this.detailEl?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  /** From the history: show the record a repayment belongs to. */
  openLoanOf(r: LoanRepayment): void {
    const loan = this.view?.loans.find(l => l.id === r.loanId);

    if (loan) {
      this.tab = loan.direction;
      this.select(loan);
    }
  }

  // ---------------------------------------------------------------- record editor

  onNew(direction: LoanDirection): void {
    this.editing = null;
    this.editorDirection = direction;
    this.editorError = '';
    this.editorOpen = true;
  }

  onEdit(loan: Loan): void {
    this.editing = loan;
    this.editorDirection = loan.direction;
    this.editorError = '';
    this.editorOpen = true;
  }

  onCloseEditor(): void {
    if (!this.busy) {
      this.editorOpen = false;
      this.editing = null;
    }
  }

  onSaveLoan(draft: LoanDraft): void {
    this.busy = true;
    this.editorError = '';
    const editing = this.editing;
    const request = editing
      ? this.loans.update(editing.id, draft)
      : this.loans.create({ ...draft, requestId: this.editorRequestId });

    request.subscribe({
      next: ({ loan }) => {
        this.busy = false;
        this.editorOpen = false;
        this.editing = null;
        this.editorRequestId = newRequestId();
        this.tab = loan.direction;
        this.toast.success(editing
          ? `${loan.personName} updated.`
          : `Recorded ₹${this.fmt(loan.principal)} ${loan.direction === 'lent' ? 'given to' : 'received from'} ${loan.personName}.`);
        this.load(loan.id);
      },
      error: error => {
        this.busy = false;
        this.editorError = error.message;
      }
    });
  }

  // ---------------------------------------------------------------- repayments

  onOpenRepay(loan: Loan): void {
    this.repayFor = loan;
    this.quote = null;
    this.repayError = '';
    this.onQuoteDate(this.today < (loan.lastPaidOn ?? '') ? loan.lastPaidOn! : this.today);
  }

  onQuoteDate(date: string): void {
    const loan = this.repayFor;
    if (!loan) return;

    this.loans.quote(loan.id, date).subscribe({
      next: quote => { if (this.repayFor?.id === loan.id) this.quote = quote; },
      error: error => { this.repayError = error.message; }
    });
  }

  onCloseRepay(): void {
    if (!this.busy) {
      this.repayFor = null;
      this.quote = null;
    }
  }

  onSaveRepay(save: RepaymentSave): void {
    const loan = this.repayFor;
    if (!loan) return;

    this.busy = true;
    this.repayError = '';

    this.loans.repay(loan.id, { ...save, requestId: this.repayRequestId }).subscribe({
      next: ({ repayment, loan: after }) => {
        this.busy = false;
        this.repayFor = null;
        this.quote = null;
        this.repayRequestId = newRequestId();
        const interest = repayment.interest > 0 ? ` (₹${this.fmt(repayment.interest)} of it interest)` : '';
        this.toast.success(
          `₹${this.fmt(repayment.amount)}${interest} ${loan.direction === 'lent' ? 'received into' : 'paid from'} ${repayment.accountName}.` +
          (after?.status === 'completed' ? ` ${loan.personName} is fully settled.` : '')
        );
        this.load(loan.id);
      },
      error: error => {
        this.busy = false;
        this.repayError = error.message;
      }
    });
  }

  onAskReverse(loan: Loan, repayment: LoanRepayment): void {
    this.confirmReverse = { loan, repayment };
  }

  onConfirmReverse(): void {
    const pending = this.confirmReverse;
    if (!pending) return;

    this.busy = true;
    this.loans.reverse(pending.loan.id, pending.repayment.id).subscribe({
      next: () => {
        this.busy = false;
        this.confirmReverse = null;
        this.toast.success(`Repayment of ₹${this.fmt(pending.repayment.amount)} reversed. ${pending.repayment.accountName} is back as it was.`);
        this.load(pending.loan.id);
      },
      error: error => {
        this.busy = false;
        this.confirmReverse = null;
        this.toast.error(error.message);
      }
    });
  }

  // ---------------------------------------------------------------- cancelling

  onAskCancel(loan: Loan): void {
    this.confirmCancel = loan;
    this.cancelReason = '';
  }

  onConfirmCancel(): void {
    const loan = this.confirmCancel;
    if (!loan) return;

    this.busy = true;
    this.loans.cancel(loan.id, this.cancelReason.trim() || null).subscribe({
      next: ({ reversedRepayments }) => {
        this.busy = false;
        this.confirmCancel = null;
        const principal = loan.direction === 'lent'
          ? `₹${this.fmt(loan.principal)} is back in ${loan.accountName}`
          : `₹${this.fmt(loan.principal)} came back out of ${loan.accountName}`;
        const repaid = reversedRepayments
          ? `, and ${reversedRepayments} ${reversedRepayments === 1 ? 'repayment was' : 'repayments were'} reversed in ${reversedRepayments === 1 ? 'its account' : 'their accounts'}`
          : '';
        this.toast.success(`${loan.personName} cancelled: ${principal}${repaid}.`);
        this.load(loan.id);
      },
      error: error => {
        this.busy = false;
        this.confirmCancel = null;
        this.toast.error(error.message);
      }
    });
  }
}
