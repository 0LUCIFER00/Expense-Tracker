import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { catchError, of } from 'rxjs';
import { FitsScreenDirective } from '../shared/fits-screen.directive';
import { GoalDraft, GoalEntry, GoalsOverview, SavingsGoal } from '../shared/models';
import { GoalsService, goalDate, goalIconPath, goalStateWord } from '../shared/goals.service';
import { ToastService } from '../shared/toast.service';
import { GoalEditorComponent } from './goal-editor/goal-editor.component';
import { EntryKind, EntrySave, GoalEntryComponent } from './goal-entry/goal-entry.component';

type Tab = 'active' | 'paused' | 'completed' | 'all';

/**
 * Savings goals: money set aside for something, tracked against a target and
 * a date. Tracking only — nothing here moves money between accounts. Every
 * figure comes from the API.
 */
@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [DecimalPipe, NgTemplateOutlet, FitsScreenDirective, GoalEditorComponent, GoalEntryComponent],
  templateUrl: './goals.component.html',
  styleUrl: './goals.component.css'
})
export class GoalsComponent implements OnInit {
  private readonly goalsService = inject(GoalsService);
  private readonly toast = inject(ToastService);

  @ViewChild('detail') detailEl?: ElementRef<HTMLElement>;

  view: GoalsOverview | null = null;
  loading = true;
  loadError = '';
  busy = false;
  tab: Tab = 'active';

  selectedId: string | null = null;
  history: GoalEntry[] = [];
  historyLoading = false;

  /** Open dialogs. */
  editorOpen = false;
  editing: SavingsGoal | null = null;
  entryKind: EntryKind | null = null;
  confirmDelete: SavingsGoal | null = null;

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'paused', label: 'Paused' },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' }
  ];

  readonly goalDate = goalDate;
  readonly iconPath = goalIconPath;
  readonly stateWord = goalStateWord;

  get today(): string {
    return this.view?.today ?? '';
  }

  get canManage(): boolean {
    return this.view?.canManage ?? false;
  }

  count(tab: Tab): number {
    const goals = this.view?.goals ?? [];
    return tab === 'all' ? goals.length : goals.filter(g => g.status === tab).length;
  }

  get shown(): SavingsGoal[] {
    const goals = this.view?.goals ?? [];
    return (this.tab === 'all' ? goals : goals.filter(g => g.status === this.tab))
      .slice()
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  }

  get selected(): SavingsGoal | null {
    return this.view?.goals.find(g => g.id === this.selectedId) ?? null;
  }

  ngOnInit(): void {
    this.load();
  }

  /** A word for the chip, and its colour family. */
  tone(goal: SavingsGoal): string {
    return {
      'on-track': 'ok', behind: 'warn', 'date-passed': 'warn',
      reached: 'info', paused: 'muted', completed: 'info'
    }[goal.state];
  }

  /** The line under a goal's bar. */
  note(goal: SavingsGoal): string {
    if (goal.state === 'completed') return 'Completed';
    if (goal.state === 'reached') return goal.over > 0 ? `₹${this.fmt(goal.over)} over` : 'Target reached';
    if (goal.state === 'date-passed') return `₹${this.fmt(goal.remaining)} to go`;
    if (goal.state === 'paused') return `₹${this.fmt(goal.remaining)} to go`;
    return goal.monthly !== null ? `₹${this.fmt(goal.monthly)} a month` : `₹${this.fmt(goal.remaining)} to go`;
  }

  byText(goal: SavingsGoal): string {
    return goal.targetDate < this.today && goal.status !== 'completed'
      ? `Was due ${goalDate(goal.targetDate)}`
      : `By ${goalDate(goal.targetDate)}`;
  }

  width(goal: SavingsGoal): number {
    return Math.min(100, Math.max(0, goal.percent));
  }

  fmt(value: number): string {
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  setTab(tab: Tab): void {
    this.tab = tab;

    if (!this.shown.some(g => g.id === this.selectedId)) {
      this.select(this.shown[0] ?? null, false);
    }
  }

  select(goal: SavingsGoal | null, scroll = true): void {
    this.selectedId = goal?.id ?? null;
    this.history = [];

    if (!goal) {
      return;
    }

    this.loadHistory(goal.id);

    // On a phone the detail sits under the list; bring it into view.
    if (scroll && typeof window !== 'undefined' && window.matchMedia?.('(max-width: 999px)').matches) {
      setTimeout(() => this.detailEl?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  onRetryLoad(): void {
    this.load();
  }

  onNew(): void {
    this.editing = null;
    this.editorOpen = true;
  }

  onEdit(goal: SavingsGoal): void {
    this.editing = goal;
    this.editorOpen = true;
  }

  onCloseEditor(): void {
    this.editorOpen = false;
    this.editing = null;
  }

  onSave(draft: GoalDraft): void {
    const current = this.editing;
    this.busy = true;

    (current ? this.goalsService.update(current.id, draft) : this.goalsService.create(draft)).subscribe({
      next: goal => {
        this.busy = false;
        this.editorOpen = false;
        this.editing = null;
        this.toast.success(current ? `${goal.name} saved. Its history is unchanged.` : `${goal.name} created.`);

        if (!current) {
          this.tab = 'active';
        }

        this.selectedId = goal.id;
        this.load();
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onOpenEntry(kind: EntryKind): void {
    this.entryKind = kind;
  }

  onCloseEntry(): void {
    this.entryKind = null;
  }

  onSaveEntry(entry: EntrySave): void {
    const goal = this.selected;

    if (!goal) {
      return;
    }

    this.busy = true;
    this.goalsService.addEntry(goal.id, entry.kind, { amount: entry.amount, date: entry.date, note: entry.note }).subscribe({
      next: ({ goal: updated }) => {
        this.busy = false;
        this.entryKind = null;
        this.toast.success(entry.kind === 'contribution'
          ? `Added ₹${this.fmt(entry.amount)} to ${updated.name}. Your accounts are unchanged.`
          : `Withdrew ₹${this.fmt(entry.amount)} from ${updated.name}. Your accounts are unchanged.`);

        if (updated.state === 'reached' && goal.state !== 'reached') {
          this.toast.success(`${updated.name} has reached its target. Mark it complete when you're ready.`);
        }

        this.load();
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onStatus(goal: SavingsGoal, action: 'pause' | 'resume' | 'complete' | 'reopen'): void {
    this.busy = true;
    this.goalsService.setStatus(goal.id, action).subscribe({
      next: updated => {
        this.busy = false;
        this.toast.success({
          pause: `${updated.name} paused.`,
          resume: `${updated.name} resumed.`,
          complete: `${updated.name} completed. Well done!`,
          reopen: `${updated.name} reopened.`
        }[action]);
        // Follow the goal to the tab it now belongs to.
        this.tab = updated.status;
        this.load();
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  onAskDelete(goal: SavingsGoal): void {
    this.editorOpen = false;
    this.confirmDelete = goal;
  }

  onCancelDelete(): void {
    this.confirmDelete = null;
  }

  onConfirmDelete(): void {
    const goal = this.confirmDelete;
    this.confirmDelete = null;

    if (!goal) {
      return;
    }

    this.busy = true;
    this.goalsService.remove(goal.id).subscribe({
      next: () => {
        this.busy = false;
        this.toast.success(`${goal.name} deleted. Your accounts and transactions are unchanged.`);
        this.selectedId = null;
        this.load();
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  private load(): void {
    this.loading = true;
    this.loadError = '';

    this.goalsService.overview().subscribe({
      next: view => {
        this.view = view;
        this.loading = false;

        const keep = this.shown.find(g => g.id === this.selectedId);
        this.select(keep ?? this.shown[0] ?? null, false);
      },
      error: error => {
        this.loading = false;
        this.loadError = error.message;
      }
    });
  }

  private loadHistory(id: string): void {
    this.historyLoading = true;

    this.goalsService.activity(id).pipe(catchError(() => of([] as GoalEntry[]))).subscribe(entries => {
      if (this.selectedId === id) {
        this.history = entries;
        this.historyLoading = false;
      }
    });
  }
}
