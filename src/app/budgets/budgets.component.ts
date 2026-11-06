import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  BudgetService,
  alertLabel,
  currentMonthKey,
  daysLeft,
  isMonthKey,
  monthLabel,
  shiftMonthKey,
  statusWord
} from '../shared/budget.service';
import { BudgetDraft, BudgetLine, BudgetMonth, PreviousBudget } from '../shared/models';
import { ToastService } from '../shared/toast.service';
import { BudgetEditorComponent } from './budget-editor/budget-editor.component';
import { BudgetHistoryComponent } from './budget-history/budget-history.component';

/** What the confirmation dialog is asking about. */
type Pending =
  | { kind: 'save-copy'; draft: BudgetDraft }
  | { kind: 'delete-month' };

/**
 * Budgets: one month at a time, against what was actually spent.
 *
 * The month lives in the URL (?month=2026-11), so a month can be linked to and
 * the browser's back button walks back through the months looked at. Every
 * figure on the page comes from the API.
 */
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [DatePipe, DecimalPipe, BudgetEditorComponent, BudgetHistoryComponent],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.css'
})
export class BudgetsComponent implements OnInit {
  private readonly budgetService = inject(BudgetService);
  private readonly toast = inject(ToastService);
  // Optional so the component still builds where no router is provided.
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  monthKey = currentMonthKey();
  view: BudgetMonth | null = null;
  previous: PreviousBudget | null = null;
  categoryNames: string[] = [];

  loading = true;
  loadError = '';
  busy = false;

  /** The edit form is open, with this starting point. */
  editing = false;
  draft: BudgetDraft = { total: null, categories: [] };
  /** Set when the form was filled from an earlier month. */
  copiedFrom: string | null = null;

  /** A destructive or bulk action waiting for a yes. */
  pending: Pending | null = null;

  readonly statusWord = statusWord;
  readonly alertLabel = alertLabel;

  ngOnInit(): void {
    this.budgetService.categories().pipe(catchError(() => of([]))).subscribe(names => {
      this.categoryNames = names;
    });

    if (this.route) {
      this.route.queryParamMap.subscribe(params => {
        const month = params.get('month');
        this.show(isMonthKey(month) ? month : currentMonthKey());
      });
    } else {
      this.show(currentMonthKey());
    }
  }

  get monthName(): string {
    return monthLabel(this.monthKey);
  }

  get isCurrentMonth(): boolean {
    return this.monthKey === currentMonthKey();
  }

  get previousName(): string {
    return this.previous ? monthLabel(this.previous.month) : '';
  }

  get daysToGo(): number {
    return daysLeft(this.monthKey);
  }

  get isOver(): boolean {
    return this.view?.remaining !== null && (this.view?.remaining ?? 0) < 0;
  }

  /** "Over" for a line strictly past its limit; "Reached" at exactly 100%. */
  lineWord(line: BudgetLine): string {
    return statusWord(line);
  }

  scopeName(scope: string): string {
    return scope === 'overall' ? 'This month' : scope;
  }

  width(percent: number | null): number {
    return Math.min(100, Math.max(0, percent ?? 0));
  }

  /** Moves by months; the URL changes and the page follows it. */
  onMonth(delta: number): void {
    this.go(shiftMonthKey(this.monthKey, delta));
  }

  onThisMonth(): void {
    this.go(currentMonthKey());
  }

  onRetry(): void {
    this.show(this.monthKey);
  }

  onEdit(): void {
    this.draft = {
      total: this.view?.overall ?? null,
      categories: (this.view?.categories ?? [])
        .map(line => ({ category: line.category, amount: line.budget }))
        .sort((a, b) => a.category.localeCompare(b.category))
    };
    this.copiedFrom = null;
    this.editing = true;
  }

  /** Fills the form from the latest earlier budget; nothing is saved yet. */
  onCopy(): void {
    if (!this.previous) {
      return;
    }

    this.draft = { total: this.previous.total, categories: [...this.previous.categories] };
    this.copiedFrom = this.previous.month;
    this.editing = true;
  }

  onCancelEdit(): void {
    this.editing = false;
    this.copiedFrom = null;
  }

  /** A copied budget is confirmed before it is saved; an edited one is not. */
  onSave(draft: BudgetDraft): void {
    if (this.copiedFrom) {
      this.pending = { kind: 'save-copy', draft };
      return;
    }

    this.save(draft);
  }

  onAskDelete(): void {
    this.pending = { kind: 'delete-month' };
  }

  onCancelPending(): void {
    this.pending = null;
  }

  onConfirmPending(): void {
    const pending = this.pending;
    this.pending = null;

    if (pending?.kind === 'save-copy') {
      this.save(pending.draft);
    } else if (pending?.kind === 'delete-month') {
      this.remove();
    }
  }

  private go(key: string): void {
    if (this.router) {
      this.router.navigate([], { queryParams: { month: key }, replaceUrl: false });
    } else {
      this.show(key);
    }
  }

  private show(key: string): void {
    this.monthKey = key;
    this.editing = false;
    this.copiedFrom = null;
    this.pending = null;
    this.loading = true;
    this.loadError = '';

    forkJoin({
      view: this.budgetService.month(key),
      // Only what the Copy button needs; the page works without it.
      previous: this.budgetService.previous(key).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ view, previous }) => {
        // A slow answer for a month already navigated away from is dropped.
        if (key !== this.monthKey) {
          return;
        }

        this.view = view;
        this.previous = previous;
        this.loading = false;
      },
      error: error => {
        if (key !== this.monthKey) {
          return;
        }

        this.view = null;
        this.loading = false;
        this.loadError = error.message;
      }
    });
  }

  private save(draft: BudgetDraft): void {
    this.busy = true;

    this.budgetService.save(this.monthKey, draft).subscribe({
      next: view => {
        this.busy = false;
        this.view = view;
        this.editing = false;
        this.copiedFrom = null;
        this.toast.success(`Budget for ${this.monthName} saved.`);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }

  private remove(): void {
    this.busy = true;

    this.budgetService.remove(this.monthKey).subscribe({
      next: view => {
        this.busy = false;
        this.view = view;
        this.toast.success(`Budget for ${this.monthName} removed. Your expenses are unchanged.`);
      },
      error: error => {
        this.busy = false;
        this.toast.error(error.message);
      }
    });
  }
}
