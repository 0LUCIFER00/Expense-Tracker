import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { BalanceService } from '../shared/balance.service';
import { ExpenseService } from '../shared/expense.service';
import { IncomeService } from '../shared/income.service';
import { FitsScreenDirective } from '../shared/fits-screen.directive';
import {
  BalanceAccount,
  RecurringOverview,
  RecurringRun,
  RecurringSchedule,
  RecurringSync
} from '../shared/models';
import {
  RecurringService,
  dateLabel,
  relativeDay,
  remindLabel,
  repeatLabel
} from '../shared/recurring.service';
import { SettingsService } from '../shared/settings.service';
import { ToastService } from '../shared/toast.service';
import { RecurringEditorComponent, RecurringSave } from './recurring-editor/recurring-editor.component';

type Tab = 'all' | 'expense' | 'income' | 'inactive';

/**
 * Recurring bills and income. Opening the page first asks the server to add
 * anything that has come due, then shows the schedules. Every figure comes
 * from the API; nothing is added from the browser.
 */
@Component({
  selector: 'app-recurring',
  standalone: true,
  imports: [DecimalPipe, NgTemplateOutlet, FitsScreenDirective, RecurringEditorComponent],
  templateUrl: './recurring.component.html',
  styleUrl: './recurring.component.css'
})
export class RecurringComponent implements OnInit {
  private readonly recurring = inject(RecurringService);
  private readonly balances = inject(BalanceService);
  private readonly expenses = inject(ExpenseService);
  private readonly incomes = inject(IncomeService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);

  view: RecurringOverview | null = null;
  loading = true;
  loadError = '';
  busy = false;
  tab: Tab = 'all';

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'expense', label: 'Debit' },
    { key: 'income', label: 'Credit' },
    { key: 'inactive', label: 'Paused & ended' }
  ];

  accounts: BalanceAccount[] = [];
  expenseCategories: string[] = [];
  incomeCategories: string[] = [];

  /** The editor: open for a new schedule (null) or an existing one. */
  editorOpen = false;
  editing: RecurringSchedule | null = null;
  history: RecurringRun[] = [];

  /** Waiting for a yes before deleting. */
  confirmDelete: RecurringSchedule | null = null;

  readonly dateLabel = dateLabel;
  readonly relativeDay = relativeDay;
  readonly remindLabel = remindLabel;

  get today(): string {
    return this.view?.today ?? '';
  }

  get canManage(): boolean {
    return this.view?.canManage ?? false;
  }

  get canUseAccounts(): boolean {
    return this.settings.canUpdateBalance;
  }

  get canAddIncome(): boolean {
    return this.settings.canAddMoney && this.settings.canUpdateBalance;
  }

  get canBackdate(): boolean {
    return this.settings.canBackdate;
  }

  get counts(): Record<Tab, number> {
    const all = this.view?.schedules ?? [];
    return {
      all: all.length,
      expense: all.filter(s => s.kind === 'expense').length,
      income: all.filter(s => s.kind === 'income').length,
      inactive: all.filter(s => s.status !== 'active').length
    };
  }

  get shown(): RecurringSchedule[] {
    const all = this.view?.schedules ?? [];
    const rank = { active: 0, paused: 1, completed: 2 };

    return all
      .filter(s => this.tab === 'all'
        || (this.tab === 'inactive' ? s.status !== 'active' : s.kind === this.tab))
      .sort((a, b) => rank[a.status] - rank[b.status]
        || (a.nextDueOn ?? '9999').localeCompare(b.nextDueOn ?? '9999'));
  }

  /** Failed occurrences, newest first. */
  get failed(): RecurringRun[] {
    return (this.view?.overdue ?? []).flatMap(item => item.type === 'failed' ? [item.run] : []);
  }

  /** Due but not yet run: only while the daily job or a sync has not got to it. */
  get waiting(): RecurringSchedule[] {
    return (this.view?.overdue ?? []).flatMap(item => item.type === 'not-run' ? [item.schedule] : []);
  }

  ngOnInit(): void {
    forkJoin({
      accounts: this.balances.list().pipe(catchError(() => of([] as BalanceAccount[]))),
      expense: this.expenses.listCategories().pipe(catchError(() => of([] as string[]))),
      income: this.incomes.listCategories().pipe(catchError(() => of([] as string[])))
    }).subscribe(({ accounts, expense, income }) => {
      this.accounts = accounts;
      this.expenseCategories = expense;
      this.incomeCategories = income;
    });

    this.load(true);
  }

  repeat(s: RecurringSchedule): string {
    return repeatLabel(s.frequency, s.interval, s.anchorOn);
  }

  statusWord(s: RecurringSchedule): string {
    if (s.status === 'paused') return 'Paused';
    if (s.status === 'completed') return 'Ended';
    if (this.failed.some(run => run.scheduleId === s.id) || s.accountMissing) return 'Needs attention';
    return 'Active';
  }

  statusKey(s: RecurringSchedule): string {
    return { 'Paused': 'paused', 'Ended': 'ended', 'Needs attention': 'over', 'Active': 'ok' }[this.statusWord(s)]!;
  }

  nextText(s: RecurringSchedule): string {
    if (s.status === 'completed') return 'Ended';
    if (s.status === 'paused' || !s.nextDueOn) return '—';

    const days = s.nextDueOn ? relativeDay(s.nextDueOn, this.today) : '';
    return days === 'Today' || days === 'Tomorrow' ? days : dateLabel(s.nextDueOn, this.today);
  }

  setTab(tab: Tab): void {
    this.tab = tab;
  }

  onRetryLoad(): void {
    this.load(false);
  }

  onNew(): void {
    this.editing = null;
    this.history = [];
    this.editorOpen = true;
  }

  onEdit(s: RecurringSchedule): void {
    this.editing = s;
    this.history = [];
    this.editorOpen = true;

    this.recurring.runs(s.id).pipe(catchError(() => of([]))).subscribe(runs => {
      if (this.editing?.id === s.id) {
        this.history = runs;
      }
    });
  }

  onCloseEditor(): void {
    this.editorOpen = false;
    this.editing = null;
  }

  onSave({ draft, active }: RecurringSave): void {
    const current = this.editing;
    this.busy = true;

    const saved = current
      ? this.recurring.update(current.id, draft).pipe(
          switchMap(schedule => {
            if (schedule.status === 'active' && !active) return this.recurring.pause(schedule.id);
            if (schedule.status === 'paused' && active) return this.recurring.resume(schedule.id);
            return of(schedule);
          })
        )
      : this.recurring.create(draft);

    saved.subscribe({
      next: schedule => {
        this.busy = false;
        this.editorOpen = false;
        this.editing = null;
        this.toast.success(current
          ? `${schedule.description} saved. Entries already added are unchanged.`
          : `${schedule.description} scheduled. First on ${dateLabel(schedule.nextDueOn, this.today)}.`);
        // A schedule starting today is added straight away.
        this.load(true);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onTogglePause(s: RecurringSchedule): void {
    this.busy = true;
    const call = s.status === 'paused' ? this.recurring.resume(s.id) : this.recurring.pause(s.id);

    call.subscribe({
      next: updated => {
        this.busy = false;
        this.toast.success(updated.status === 'paused'
          ? `${s.description} paused. Nothing is added until you resume it.`
          : `${s.description} resumed. Next on ${dateLabel(updated.nextDueOn, this.today)}.`);
        this.load(true);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onAskDelete(s: RecurringSchedule): void {
    this.editorOpen = false;
    this.confirmDelete = s;
  }

  onCancelDelete(): void {
    this.confirmDelete = null;
  }

  onConfirmDelete(): void {
    const s = this.confirmDelete;
    this.confirmDelete = null;

    if (!s) {
      return;
    }

    this.busy = true;
    this.recurring.remove(s.id).subscribe({
      next: () => {
        this.busy = false;
        this.toast.success(`${s.description} deleted. The entries it added are still there.`);
        this.load(false);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onRetryRun(run: RecurringRun): void {
    this.busy = true;
    this.recurring.retry(run.id).subscribe({
      next: outcome => {
        this.busy = false;

        if (outcome.status === 'posted') {
          this.toast.success(`${run.description} added for ${dateLabel(run.dueOn, this.today)}.`);
        } else {
          this.toast.error(`${run.description} still not added: ${outcome.error}`);
        }

        for (const alert of outcome.budgetAlerts ?? []) {
          this.toast.warning(alert.message);
        }

        this.load(false);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onSkipRun(run: RecurringRun): void {
    this.busy = true;
    this.recurring.skip(run.id).subscribe({
      next: () => {
        this.busy = false;
        this.toast.success(`Skipped ${run.description} for ${dateLabel(run.dueOn, this.today)}. Nothing was added.`);
        this.load(false);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  /** With `sync`, first adds whatever has come due, then shows the page. */
  private load(sync: boolean): void {
    this.loadError = '';
    this.loading = true;

    const before = sync
      ? this.recurring.sync().pipe(catchError(() => of(null)))
      : of(null);

    before.pipe(switchMap(result => {
      this.announce(result);
      return this.recurring.overview();
    })).subscribe({
      next: view => {
        this.view = view;
        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.loadError = error.message;
      }
    });
  }

  private announce(result: RecurringSync | null): void {
    if (!result) {
      return;
    }

    if (result.added.length) {
      this.toast.success(result.added.length === 1
        ? `${result.added[0].description} was added for ${dateLabel(result.added[0].dueOn, result.today)}.`
        : `${result.added.length} recurring entries were added.`);
    }

    for (const failed of result.failed) {
      this.toast.error(`${failed.description} was not added: ${failed.error}`);
    }

    for (const alert of result.budgetAlerts) {
      this.toast.warning(alert.message);
    }
  }
}
