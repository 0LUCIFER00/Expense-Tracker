import { CommonModule } from '@angular/common';
import { TransactionDetailsComponent } from './transaction-details/transaction-details.component';
import { TransactionImportComponent } from './transaction-import/transaction-import.component';
import { RecentlyDeletedComponent } from './recently-deleted/recently-deleted.component';
import { TransactionCalendarComponent } from './transaction-calendar/transaction-calendar.component';
import { MonthKey, monthLabel, monthOf, shiftMonth } from './transaction-calendar/calendar-month';
import {
  ADVANCED_KEYS,
  AdvancedKey,
  EMPTY_FILTERS,
  FilterChip,
  ListKey,
  MONTH_NAMES,
  NO_ACCOUNT,
  OLDER_YEARS,
  PERIOD_LABELS,
  RECENT_YEARS,
  Period,
  TransactionFilters,
  chipsFor,
  compile,
  filterProblem,
  isNarrowed,
  matchesFilters,
  matchesSearch,
  paymentMethodOf,
  searchText,
  toggled,
  totalsOf,
  withoutChip
} from './transaction-filters';
import { Component, ElementRef, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Expense, Income, SplitSummary } from '../shared/models';
import { ExpenseService, UNCATEGORISED } from '../shared/expense.service';
import { IncomeService } from '../shared/income.service';
import { downloadCsv } from '../shared/csv';
import { ToastService } from '../shared/toast.service';
import { SettingsService } from '../shared/settings.service';
import { parseLocalDate, todayInIndia } from '../shared/date-utils';
import { FitsScreenDirective } from '../shared/fits-screen.directive';

/** Which half of the ledger is on screen. */
/** 'deleted' is Recently deleted: removed entries, which the other three never list. */
export type TransactionTab = 'all' | 'out' | 'in' | 'deleted';

/** How a repayment is labelled where an income would show its source. */
export const REPAYMENT = 'Repayment';

/**
 * One line of the ledger: an expense or money in, in a shape the table can
 * sort, filter and draw without caring which it is.
 */
export interface TransactionRow {
  /** Unique across both kinds, since an expense and an income may share an id. */
  key: string;
  kind: 'out' | 'in';
  date: string;
  amount: number;
  description: string;
  /** The expense category, or where money in came from. */
  category: string;
  /** The account it left or arrived in; null when this session may not see it. */
  account: string | null;
  /** Sorts and reads as "Done", "Waiting" or "In". */
  status: string;
  createdAt: string;
  expense?: Expense;
  income?: Income;
}

type SortColumn = 'date' | 'amount' | 'description' | 'category' | 'account' | 'status';

const TABS: TransactionTab[] = ['all', 'out', 'in', 'deleted'];

/**
 * Transactions — what used to be View Expenses, now with money in beside it.
 *
 * One page rather than a second list for money in: the filters, sorting,
 * export and expanding rows all apply to both, and a repayment reads best in
 * date order next to the split it pays back. The Money out tab is the old page
 * exactly, so nothing anyone relied on there has moved.
 */
@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, FormsModule, FitsScreenDirective, TransactionDetailsComponent, TransactionImportComponent, RecentlyDeletedComponent,
    TransactionCalendarComponent],
  templateUrl: './expense-list.component.html',
  styleUrls: ['./expense-list.component.css', './transaction-panel.css', './transaction-filters.css', './transaction-view.css']
})
export class ExpenseListComponent implements OnInit {
  private readonly expenseService = inject(ExpenseService);
  private readonly incomeService = inject(IncomeService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  // Optional so the component still builds where no router is provided.
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  readonly tabs: { value: TransactionTab; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'out', label: 'Debit' },
    { value: 'in', label: 'Credit' }
  ];

  tab: TransactionTab = 'all';

  /** Everything the server returned; the lists below are filtered views of it. */
  private allExpenses: Expense[] = [];
  private allIncomes: Income[] = [];

  /** Expenses that pass the filters, sorted — whichever tab is showing. */
  expenses: Expense[] = [];
  /** Money in that passes the filters, sorted. */
  incomes: Income[] = [];
  /** What the table draws: the tab's share of the two lists above. */
  rows: TransactionRow[] = [];

  /** The owner's own spending: of a split expense, only their share. */
  total = 0;
  /** Money that came in as income — repayments are not income. */
  moneyIn = 0;
  /** Money people handed back for their part of a split. */
  paidBack = 0;

  /** Split expenses by id, with their repayments, for the details drawer. */
  splits = new Map<string, SplitSummary>();

  /** The row whose details drawer is open, if any. */
  openRow: TransactionRow | null = null;

  loading = true;

  /** Every filter applied to the list (the tab aside); see transaction-filters.ts. */
  filters: TransactionFilters = { ...EMPTY_FILTERS };
  /** The Filter menu's choices being edited, applied together with Apply filters. */
  draft: Pick<TransactionFilters, AdvancedKey> = this.advancedOf(EMPTY_FILTERS);
  /** Whether the Filter menu beside the search is open. */
  advancedOpen = false;
  advancedError = '';
  /** Why a custom date range was not applied (its ends cross, or one is not a date). */
  dateError = '';
  /** One removable chip per active filter, shown above the list. */
  chips: FilterChip[] = [];

  /** List (the default) or the month as a calendar. */
  view: 'list' | 'calendar' = 'list';
  /** Today in India, which the calendar and the date filters go by. */
  indiaToday = todayInIndia();
  /** The month the calendar shows. */
  calendarMonth: MonthKey = monthOf(this.indiaToday);
  /** Every row that passes the search, filters and tab, whatever its date: the calendar picks its month. */
  calendarRows: TransactionRow[] = [];

  /** The list is shown a page at a time; sorting and filters cover every page. */
  readonly pageSize = 50;
  page = 1;

  /** Income minus your share of settled spending, for the filtered rows. */
  net = 0;

  readonly noAccount = NO_ACCOUNT;

  /** The Year and Month menus, as before: the last five years and "Older", and the twelve months. */
  readonly years = [
    ...Array.from({ length: RECENT_YEARS }, (_, i) => {
      const year = Number(todayInIndia().slice(0, 4)) - i;
      return { value: year, label: String(year) };
    }),
    { value: OLDER_YEARS, label: 'Older' }
  ];

  readonly months = MONTH_NAMES.map((label, i) => ({ value: i + 1, label }));
  readonly periods = (Object.keys(PERIOD_LABELS) as Period[]).map(value => ({ value, label: PERIOD_LABELS[value] }));

  /** Accounts and payment methods the loaded entries use, for the More filters menus. */
  accountOptions: string[] = [];
  paymentMethods: string[] = [];

  /**
   * One category, for code that thinks in one: '' when none or several are
   * chosen. UNCATEGORISED selects the entries with no category.
   */
  get selectedCategory(): string {
    return this.filters.categories.length === 1 ? this.filters.categories[0] : '';
  }

  set selectedCategory(value: string) {
    this.filters = { ...this.filters, categories: value ? [value] : [] };
    this.draft = { ...this.draft, categories: [...this.filters.categories] };
  }

  /** What the search box holds. */
  get searchText(): string {
    return this.filters.search;
  }

  set searchText(value: string) {
    this.filters = { ...this.filters, search: value };
  }

  /** Search text per entry, built once per entry rather than on every keystroke. */
  private haystacks = new WeakMap<object, string>();

  /** Only the categories actually used, so the filter never offers a dead end. */
  usedCategories: string[] = [];

  canApprovePending = false;
  canViewSourceDetails = false;
  canRemoveExpenses = false;

  sortColumn: SortColumn | null = null;
  sortDirection: 'asc' | 'desc' | 'default' = 'default';


  ngOnInit(): void {
    const requested = this.route?.snapshot.queryParamMap.get('tab') as TransactionTab | null;

    if (requested && TABS.includes(requested)) {
      this.tab = requested;
    }

    this.reload();
  }

  /** After an import or a restore: the new entries, and the totals with them. */
  onImported(): void {
    this.reload();
  }

  private reload(): void {
    forkJoin({
      expenses: this.expenseService.list(),
      incomes: this.incomeService.list(),
      splits: this.expenseService.listSplits(),
      settings: this.settingsService.load(true)
    }).subscribe({
      next: ({ expenses, incomes, splits }) => {
        this.allExpenses = expenses;
        this.allIncomes = incomes;
        this.splits = new Map(splits.map(split => [split.id, split]));
        this.collectCategories();
        this.setViewPermission();
        this.haystacks = new WeakMap();
        this.applyFilters(true);
        this.loading = false;
      },
      error: error => {
        this.toast.error(error.message);
        this.loading = false;
      }
    });
  }

  /** What a piece of money in is filed under, for the filter and the chip. */
  private incomeCategory(income: Income): string {
    return income.splitExpenseId ? REPAYMENT : income.category ?? UNCATEGORISED;
  }

  /** The categories in use on the tab showing, so each tab filters by its own. */
  private collectCategories(): void {
    const names = new Set<string>();

    if (this.tab !== 'in') {
      this.allExpenses.forEach(expense => names.add(expense.category ?? UNCATEGORISED));
    }

    if (this.tab !== 'out') {
      this.allIncomes.forEach(income => names.add(this.incomeCategory(income)));
    }

    this.usedCategories = [...names].sort();

    // Accounts and payment methods in use, for the More filters menus.
    const accounts = new Set<string>();
    const methods = new Set<string>();

    for (const expense of this.allExpenses) {
      if (expense.sourceCategory) accounts.add(expense.sourceCategory);
      if (expense.imported?.paymentMethod) methods.add(expense.imported.paymentMethod);
    }

    for (const income of this.allIncomes) {
      if (income.targetCategory) accounts.add(income.targetCategory);
      if (income.imported?.paymentMethod) methods.add(income.imported.paymentMethod);
    }

    this.accountOptions = [...accounts].sort();
    this.paymentMethods = [...methods].sort();

    // A filter left pointing at a category that no longer has entries would
    // show an empty list with no clue why.
    const kept = this.filters.categories.filter(name => names.has(name));

    if (kept.length !== this.filters.categories.length) {
      this.filters = { ...this.filters, categories: kept };
      this.draft = { ...this.draft, categories: [...kept] };
    }
  }

  setViewPermission(): void {
    this.canViewSourceDetails = this.settingsService.canViewSource;
    this.canApprovePending = this.settingsService.canBackdate;
    this.canRemoveExpenses = this.settingsService.canRemove;
  }

  /** Switches half of the ledger, and records it in the address for a refresh. */
  onTab(tab: TransactionTab): void {
    if (tab === this.tab) {
      return;
    }

    this.tab = tab;
    this.openRow = null;
    this.collectCategories();
    this.applyFilters();

    this.router?.navigate([], {
      relativeTo: this.route ?? undefined,
      queryParams: { tab: tab === 'all' ? null : tab },
      replaceUrl: true
    });
  }

  onApprovePending(expense: Expense): void {
    this.expenseService.approve(expense.id).subscribe({
      next: approved => {
        this.toast.success('Approved.');

        // Approval is when it starts counting, so it can carry a budget over.
        for (const alert of approved.budgetAlerts ?? []) {
          this.toast.warning(alert.message);
        }

        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  /** The split a row belongs to: its own if it was split, or the one a repayment pays back. */
  splitFor(row: TransactionRow): SplitSummary | null {
    const id = row.expense?.splitMembers ? row.expense.id : row.income?.splitExpenseId;

    return id ? this.splits.get(id) ?? null : null;
  }

  /** Any row opens its details: an expense or money in alike. */
  onOpenRow(row: TransactionRow): void {
    this.openRow = row;
  }

  closeDetails(): void {
    this.openRow = null;
  }

  /** From a repayment's details, the split expense it pays back. */
  onOpenSplitExpense(id: string): void {
    const expense = this.allExpenses.find(e => e.id === id);

    if (expense) {
      this.openRow = this.fromExpense(expense);
    }
  }

  /** Remove, confirmed in the drawer. */
  onRemoveOpen(): void {
    const row = this.openRow;
    this.openRow = null;

    if (row?.expense) {
      this.onDelete(row.expense);
    } else if (row?.income) {
      this.onDeleteIncome(row.income);
    }
  }

  onApproveOpen(): void {
    const expense = this.openRow?.expense;
    this.openRow = null;

    if (expense) {
      this.onApprovePending(expense);
    }
  }

  /** A receipt was added or removed in the drawer; the paperclip follows. */
  onAttachmentCount(count: number): void {
    if (this.openRow?.expense) {
      this.openRow.expense.attachmentCount = count;
    }
  }

  onDelete(expense: Expense): void {
    this.expenseService.remove(expense.id).subscribe({
      next: removed => {
        // Say so when money went back, otherwise the balance silently changing
        // looks like a second bug; and say where it went, so it can be found.
        this.toast.success(
          (removed.refunded
            ? `Moved to Recently deleted. ₹${Number(expense.amount).toLocaleString()} put back ` +
              `into ${removed.sourceCategory}.`
            : 'Moved to Recently deleted.') + ' You can restore it for 30 days.'
        );

        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  /**
   * Removing money in takes it back out of the account. The server refuses
   * when the account has since been spent below it, and says why.
   */
  onDeleteIncome(income: Income): void {
    this.incomeService.remove(income.id).subscribe({
      next: removed => {
        this.toast.success(
          (removed.reversed
            ? `Moved to Recently deleted. ₹${Number(income.amount).toLocaleString()} taken back out ` +
              `of ${removed.targetCategory}.`
            : 'Moved to Recently deleted.') + ' You can restore it for 30 days.'
        );

        this.reload();
      },
      error: error => {
        this.toast.error(error.message);
      }
    });
  }

  onPeriod(event: Event): void {
    const period = (event.target as HTMLSelectElement).value as Period;

    this.dateError = '';
    // A date range and a year or month would fight; the newer choice wins.
    const yearMonth = period === 'all' ? {} : { year: 0, month: 0 };
    this.filters = period === 'custom'
      ? { ...this.filters, ...yearMonth, period }
      : { ...this.filters, ...yearMonth, period, from: '', to: '' };
    this.applyFilters();
  }

  onFilterYear(event: Event): void {
    this.setYearMonth({ year: Number((event.target as HTMLSelectElement).value) });
  }

  onFilterMonth(event: Event): void {
    this.setYearMonth({ month: Number((event.target as HTMLSelectElement).value) });
  }

  /** A year or month clears any date range, so the two never contradict. */
  private setYearMonth(change: Partial<Pick<TransactionFilters, 'year' | 'month'>>): void {
    this.dateError = '';
    this.filters = { ...this.filters, ...change, period: 'all', from: '', to: '' };
    this.applyFilters();
  }

  /** A custom range's end; a range whose ends cross is not applied, and says why. */
  onDate(end: 'from' | 'to', event: Event): void {
    const next = { ...this.filters, [end]: (event.target as HTMLInputElement).value };
    const problem = filterProblem(next);

    this.dateError = problem ?? '';

    if (!problem) {
      this.filters = next;
      this.applyFilters();
    }
  }

  onFilterCategory(event: Event): void {
    this.selectedCategory = (event.target as HTMLSelectElement).value;
    this.applyFilters();
  }

  onSearch(event: Event): void {
    this.searchText = (event.target as HTMLInputElement).value;
    this.applyFilters();
  }

  private advancedOf(f: TransactionFilters): Pick<TransactionFilters, AdvancedKey> {
    return {
      categories: [...f.categories], statuses: [...f.statuses], accounts: [...f.accounts],
      paymentMethods: [...f.paymentMethods], minAmount: f.minAmount, maxAmount: f.maxAmount
    };
  }

  /** Opens or closes the Filter menu. Closing without Apply forgets the unapplied choices. */
  toggleAdvanced(): void {
    if (this.advancedOpen) {
      this.closeFilterMenu();
    } else {
      this.draft = this.advancedOf(this.filters);
      this.advancedError = '';
      this.advancedOpen = true;
    }
  }

  closeFilterMenu(refocus = false): void {
    if (!this.advancedOpen) {
      return;
    }

    this.advancedOpen = false;
    this.draft = this.advancedOf(this.filters);
    this.advancedError = '';

    if (refocus) {
      this.host.nativeElement.querySelector<HTMLElement>('.filter-toggle')?.focus();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.advancedOpen && !this.host.nativeElement.querySelector('.filter-anchor')?.contains(event.target as Node)) {
      this.closeFilterMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeFilterMenu(true);
  }

  /** Min or max amount, as typed. */
  setDraft(key: 'minAmount' | 'maxAmount', value: string): void {
    this.draft = { ...this.draft, [key]: value };
    this.advancedError = '';
  }

  /** Ticks or unticks one option of a multiple-choice filter. */
  toggleDraft(key: ListKey, value: string): void {
    this.draft = { ...this.draft, [key]: toggled(this.draft[key] as string[], value) };
    this.advancedError = '';
  }

  isTicked(key: ListKey, value: string): boolean {
    return (this.draft[key] as string[]).includes(value);
  }

  /** Clears every choice in the menu (not yet applied). */
  clearDraft(): void {
    this.draft = this.advancedOf(EMPTY_FILTERS);
    this.advancedError = '';
  }

  /** True when the menu's choices differ from what is applied. */
  get draftChanged(): boolean {
    const same = (a: unknown, b: unknown) =>
      Array.isArray(a) && Array.isArray(b) ? [...a].sort().join('\n') === [...b].sort().join('\n') : a === b;

    return ADVANCED_KEYS.some(key => !same(this.draft[key], this.filters[key]));
  }

  /** How many choices the menu has applied, for the badge on its button. */
  get advancedCount(): number {
    const f = this.filters;

    return f.categories.length + f.statuses.length + f.accounts.length + f.paymentMethods.length +
      (f.minAmount.trim() ? 1 : 0) + (f.maxAmount.trim() ? 1 : 0);
  }

  /** Applies the menu's choices together, once they make sense (amounts, min below max). */
  applyAdvanced(): void {
    const next = { ...this.filters, ...this.advancedOf({ ...this.filters, ...this.draft }) };
    const problem = filterProblem(next);

    if (problem) {
      this.advancedError = problem;
      return;
    }

    this.advancedError = '';
    this.filters = next;
    this.advancedOpen = false;
    this.applyFilters();
  }

  removeChip(chip: FilterChip): void {
    this.filters = withoutChip(this.filters, chip);
    this.draft = this.advancedOf(this.filters);
    this.advancedError = '';
    this.applyFilters();
  }

  /** The From and To boxes, shown in the Year and Month row's place while a custom range is on. */
  get customRangeShown(): boolean {
    return this.filters.period === 'custom' && this.tab !== 'deleted' && this.view === 'list';
  }

  /** True when anything other than the tab narrows the list. */
  get narrowed(): boolean {
    return isNarrowed(this.filters);
  }

  /** True when anything differs from the full list: the tab, or any filter or search. */
  get hasFilters(): boolean {
    return this.tab !== 'all' || this.narrowed;
  }

  /** Clear all: back to everything, every filter and the search cleared, the All tab. */
  resetFilters(): void {
    this.filters = { ...EMPTY_FILTERS };
    this.draft = this.advancedOf(EMPTY_FILTERS);
    this.advancedError = '';
    this.dateError = '';
    this.advancedOpen = false;

    if (this.tab !== 'all') {
      // Also clears the tab from the address and re-lists the categories.
      this.onTab('all');
    } else {
      this.collectCategories();
      this.applyFilters();
    }
  }

  // ------------------------------------------------------------ pages

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.rows.length / this.pageSize));
  }

  /** The rows on the page showing, from the filtered and sorted whole. */
  get pagedRows(): TransactionRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.rows.slice(start, start + this.pageSize);
  }

  get pageFirst(): number {
    return this.rows.length ? (this.page - 1) * this.pageSize + 1 : 0;
  }

  get pageLast(): number {
    return Math.min(this.rows.length, this.page * this.pageSize);
  }

  goPage(page: number): void {
    this.page = Math.min(this.pageCount, Math.max(1, page));
  }

  setView(view: 'list' | 'calendar'): void {
    this.view = view;
    this.openRow = null;
  }

  shiftCalendar(delta: number): void {
    this.calendarMonth = shiftMonth(this.calendarMonth, delta);
  }

  calendarToToday(): void {
    this.indiaToday = todayInIndia();
    this.calendarMonth = monthOf(this.indiaToday);
  }

  get calendarTitle(): string {
    return monthLabel(this.calendarMonth);
  }

  get onThisMonth(): boolean {
    return this.calendarMonth === monthOf(this.indiaToday);
  }

  /** The chips for what is in force: the calendar chooses its own month, so a date chip does not apply there. */
  get visibleChips(): FilterChip[] {
    return this.view === 'calendar'
      ? this.chips.filter(chip => !['period', 'range', 'year', 'month'].includes(chip.key))
      : this.chips;
  }

  /**
   * Every filter and the search together, then the sort; the totals cover all
   * the matching rows (whatever the tab or page), by the dashboard's rules.
   *
   * @param keepPage after a reload (a removal, an import) stay on the page
   *   showing; any change of filter, search, sort or tab starts at page 1
   */
  applyFilters(keepPage = false): void {
    this.indiaToday = todayInIndia();
    const compiled = compile(this.filters, this.indiaToday);
    // The calendar takes every date; the month it shows is its date filter.
    const anyDate = compile({ ...this.filters, period: 'all', from: '', to: '', year: 0, month: 0 }, this.indiaToday);
    const search = this.filters.search.trim();
    const all = [
      ...this.allExpenses.map(expense => this.fromExpense(expense)),
      ...this.allIncomes.map(income => this.fromIncome(income))
    ];
    const matching = all.filter(row =>
      matchesFilters(row, compiled) && (!search || matchesSearch(this.haystack(row), search)));

    const sorted = this.applySorting(matching);

    this.expenses = sorted.filter(row => row.expense).map(row => row.expense!);
    this.incomes = sorted.filter(row => row.income).map(row => row.income!);
    this.rows = this.tab === 'all' ? sorted : sorted.filter(row => row.kind === this.tab);
    this.calendarRows = all.filter(row =>
      (this.tab === 'all' || row.kind === this.tab) &&
      matchesFilters(row, anyDate) && (!search || matchesSearch(this.haystack(row), search)));

    const totals = totalsOf(sorted);
    this.total = totals.expensePaise / 100;
    this.moneyIn = totals.incomePaise / 100;
    this.paidBack = totals.repaidPaise / 100;
    this.net = totals.netPaise / 100;

    this.chips = chipsFor(this.filters);
    this.page = keepPage ? Math.min(this.page, this.pageCount) : 1;
  }

  private haystack(row: TransactionRow): string {
    const entry = (row.expense ?? row.income) as object;
    let text = this.haystacks.get(entry);

    if (text === undefined) {
      text = searchText(row);
      this.haystacks.set(entry, text);
    }

    return text;
  }

  private sum(incomes: Income[]): number {
    return incomes.reduce((total, income) => total + Number(income.amount), 0);
  }

  private fromExpense(expense: Expense): TransactionRow {
    return {
      key: `out:${expense.id}`,
      kind: 'out',
      date: expense.date,
      amount: Number(expense.amount),
      description: expense.description,
      category: expense.category ?? UNCATEGORISED,
      account: expense.sourceCategory,
      status: expense.isPendingApproval ? 'Pending approval' : 'Completed',
      createdAt: expense.createdAt,
      expense
    };
  }

  private fromIncome(income: Income): TransactionRow {
    return {
      key: `in:${income.id}`,
      kind: 'in',
      date: income.date,
      amount: Number(income.amount),
      description: income.description,
      category: this.incomeCategory(income),
      account: income.targetCategory,
      status: 'Credit',
      createdAt: income.createdAt,
      income
    };
  }

  onSort(column: SortColumn): void {
    if (this.sortColumn !== column) {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else if (this.sortDirection === 'desc') {
      this.sortDirection = 'default';
      this.sortColumn = null;
    } else {
      this.sortDirection = 'asc';
    }

    this.applyFilters();
  }

  applySorting(rows: TransactionRow[]): TransactionRow[] {
    // Default: the latest entry first. Entries are never edited after they
    // are added, so the last one added is the last one updated.
    if (!this.sortColumn || this.sortDirection === 'default') {
      return [...rows].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const column = this.sortColumn;
    const direction = this.sortDirection === 'asc' ? 1 : -1;

    const value = (row: TransactionRow): number | string => {
      if (column === 'date') {
        return parseLocalDate(row.date).getTime();
      }

      if (column === 'amount') {
        return row.amount;
      }

      return String(row[column] ?? '').toLowerCase();
    };

    return [...rows].sort((a, b) => {
      const valueA = value(a);
      const valueB = value(b);

      return valueA < valueB ? -direction : valueA > valueB ? direction : 0;
    });
  }

  /** The list's heading, naming the tab showing. */
  get listTitle(): string {
    return this.tab === 'out' ? 'Debit' : this.tab === 'in' ? 'Credit' : 'All transactions';
  }

  /** True when the tab showing has anything to export. */
  get canExport(): boolean {
    return this.rows.length > 0;
  }

  /**
   * Downloads the rows currently on screen, filters, sorting and all.
   *
   * Built here rather than on the server: the list is already loaded, and
   * exporting what the user can actually see means the permission rules are
   * applied once instead of twice. Each tab exports its own shape; Money out
   * is the same file the old View Expenses page produced.
   */
  onExportCsv(): void {
    if (!this.canExport) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    // Every matching row, not just the page showing. Unfiltered, the file is
    // exactly what it always was; filtered, its name says so.
    const filtered = this.narrowed ? 'filtered-' : '';

    if (this.tab === 'out') {
      downloadCsv(`expenses-${filtered}${today}.csv`, ...this.expenseCsv());
    } else if (this.tab === 'in') {
      downloadCsv(`money-in-${filtered}${today}.csv`, ...this.incomeCsv());
    } else {
      downloadCsv(`transactions-${filtered}${today}.csv`, ...this.allCsv());
    }
  }

  private expenseCsv(): [string[], string[][]] {
    const headers = ['Date', 'Amount', 'Description', 'Category'];

    if (this.canViewSourceDetails) {
      headers.push('Source Type', 'Account');
    }

    // Last, so a sheet built on the earlier columns keeps reading them where
    // they were. Blank on an expense that was not split.
    headers.push('Status', 'Remarks', 'Split Between', 'Your Share');

    const rows = this.expenses.map(expense => {
      const cells = [
        expense.date,
        String(expense.amount),
        expense.description,
        expense.category ?? UNCATEGORISED
      ];

      if (this.canViewSourceDetails) {
        cells.push(expense.sourceType ?? '', expense.sourceCategory ?? '');
      }

      cells.push(
        expense.status,
        expense.remarks ?? '',
        expense.splitMembers ? String(expense.splitMembers) : '',
        expense.splitMembers ? String(expense.personalShare) : ''
      );

      return cells;
    });

    return [headers, rows];
  }

  private incomeCsv(): [string[], string[][]] {
    const headers = ['Date', 'Amount', 'Description', 'Where It Came From'];

    if (this.canViewSourceDetails) {
      headers.push('Account');
    }

    headers.push('Pays Back');

    const rows = this.incomes.map(income => {
      const cells = [
        income.date,
        String(income.amount),
        income.description,
        this.incomeCategory(income)
      ];

      if (this.canViewSourceDetails) {
        cells.push(income.targetCategory ?? '');
      }

      cells.push(income.splitDescription ?? '');

      return cells;
    });

    return [headers, rows];
  }

  /** Both kinds in one sheet, with a Type column to tell them apart. */
  private allCsv(): [string[], string[][]] {
    const headers = ['Date', 'Type', 'Amount', 'Description', 'Category'];

    if (this.canViewSourceDetails) {
      headers.push('Account');
    }

    headers.push('Status', 'Your Share', 'Pays Back');

    const rows = this.rows.map(row => {
      const cells = [
        row.date,
        row.kind === 'out' ? 'Debit' : 'Credit',
        String(row.amount),
        row.description,
        row.category
      ];

      if (this.canViewSourceDetails) {
        cells.push(row.account ?? '');
      }

      cells.push(
        row.status,
        row.expense?.splitMembers ? String(row.expense.personalShare) : '',
        row.income?.splitDescription ?? ''
      );

      return cells;
    });

    return [headers, rows];
  }

  getSortIcon(column: SortColumn): string {
    if (this.sortColumn !== column) {
      return '';
    }

    if (this.sortDirection === 'asc') {
      return ' ↑';
    }

    if (this.sortDirection === 'desc') {
      return ' ↓';
    }

    return '';
  }
}
