import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiError } from '../../shared/api.service';
import { BalanceService } from '../../shared/balance.service';
import { ExpenseService } from '../../shared/expense.service';
import { IncomeService } from '../../shared/income.service';
import { ToastService } from '../../shared/toast.service';
import { downloadCsv } from '../../shared/csv';
import { today as localToday } from '../../shared/date-utils';
import {
  CHUNK_SIZE,
  ColumnMap,
  DefaultKind,
  FIELD_LABELS,
  FIELD_ORDER,
  FileKind,
  ImportField,
  ImportFileError,
  ImportTable,
  RawFields,
  RawRow,
  autoMap,
  buildRawRows,
  buildTable,
  cellText,
  checkFile,
  decodeText,
  isSampleRow,
  kindFromColumns,
  mappingProblem,
  parseCsv,
  sha256Hex
} from '../../shared/import/import-file';
import type { TemplateKind } from '../../shared/import/templates';
import { ChunkResult, ImportService, PreviewResponse, PreviewRow } from '../../shared/import.service';

type Step = 'reading' | 'error' | 'map' | 'review' | 'confirm' | 'importing' | 'report';

/** How a row stands in the review, combining the server's check with the person's choices. */
export type RowState = 'ready' | 'duplicate' | 'invalid' | 'excluded' | 'sample' | 'imported';

export type ReviewFilter = 'all' | 'ready' | 'duplicate' | 'invalid' | 'excluded';

export interface ReviewRow {
  p: PreviewRow;
  state: RowState;
  /** Whether it goes in when the person confirms. */
  included: boolean;
  /** Ready and duplicate rows can be ticked in or out; invalid ones need fixing first. */
  toggleable: boolean;
}

interface Failure {
  row: number;
  description: string;
  error: string;
}

/** Statuses worth sending a chunk again for: the connection, or the server, not the request. */
const RETRYABLE = new Set([0, 408, 429, 500, 502, 503, 504]);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

@Component({
  selector: 'app-transaction-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transaction-import.component.html',
  styleUrls: ['./import-menu.css', './import-dialog.css', './import-review.css', './import-report.css']
})
export class TransactionImportComponent {
  private readonly importService = inject(ImportService);
  private readonly balanceService = inject(BalanceService);
  private readonly expenseService = inject(ExpenseService);
  private readonly incomeService = inject(IncomeService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Where the menu opens: below the button, lined up with its right edge, or
   * above it, lined up with its left edge (for a button at the foot of a
   * panel on the left of the page).
   */
  @Input() menuPosition: 'below-end' | 'above-start' = 'below-end';

  /** Fires after anything was imported, so the list can reload. */
  @Output() imported = new EventEmitter<void>();

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  readonly fieldLabels = FIELD_LABELS;
  readonly fields = FIELD_ORDER;
  readonly required = new Set<ImportField>(['date', 'description', 'amount']);

  readonly filterTabs: { value: ReviewFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'ready', label: 'Ready' },
    { value: 'duplicate', label: 'Duplicates' },
    { value: 'invalid', label: 'Need fixing' },
    { value: 'excluded', label: 'Left out' }
  ];

  readonly templates: { kind: TemplateKind; label: string; note: string }[] = [
    { kind: 'expense', label: 'Expense template', note: 'Money out' },
    { kind: 'income', label: 'Income template', note: 'Money in' },
    { kind: 'combined', label: 'Expense + Income', note: 'With a Type column' }
  ];

  // ------------------------------------------------------------ menu

  menuOpen = false;
  /** The template being built, as "kind-ext", while it is. */
  building: string | null = null;
  /** What the file picker was opened for. */
  picking: FileKind = 'csv';

  // ------------------------------------------------------------ dialog

  step: Step | null = null;
  /** The processing line under the progress bar. */
  status = '';
  readPercent = 0;
  error = '';

  file: { name: string; kind: FileKind; hash: string; size: number } | null = null;
  table: ImportTable | null = null;
  columns: ColumnMap = autoMap([]);
  defaultKind: DefaultKind = 'expense';
  updateBalances = true;
  /** The account for rows whose Account cell is blank (a bank statement's rows are all one account). */
  fallbackAccount = '';

  /** Corrections, by row number. */
  edits = new Map<number, Partial<RawFields>>();
  /** Rows the person left out (example rows start here). */
  skipped = new Set<number>();
  /** Duplicate rows the person chose to import anyway. */
  keptDuplicates = new Set<number>();
  samples = new Set<number>();
  /** Rows imported while this dialog has been open. */
  importedHere = new Set<number>();

  preview: PreviewResponse | null = null;
  review: ReviewRow[] = [];
  checking = false;
  previewError = '';
  filter: ReviewFilter = 'all';

  editingRow: number | null = null;
  draft: RawFields = this.emptyDraft();
  draftKind: 'expense' | 'income' = 'expense';

  // ------------------------------------------------------------ importing

  progress = { done: 0, total: 0 };
  chunkError = '';
  private queue: RawRow[][] = [];
  private chunkIndex = 0;
  private batchId = '';
  /**
   * Where every row of the file stood when the import was confirmed, for the
   * report. Each row is in exactly one: going in, a duplicate left out,
   * invalid, left out by choice, or imported earlier in this dialog.
   */
  planned = { ready: 0, duplicates: 0, invalid: 0, leftOut: 0, samples: 0, earlier: 0 };
  importedCount = 0;
  failures: Failure[] = [];
  notAttempted = 0;
  budgetAlerts: string[] = [];

  private recheckTimer: ReturnType<typeof setTimeout> | null = null;

  /** Waits before resending a chunk; the first retry waits this long, the second twice it. */
  retryDelayMs = 1000;
  /** Waits after a tick before re-checking, so several quick ticks cost one request. */
  recheckDelayMs = 350;

  // ============================================================ menu

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;

    if (this.menuOpen) {
      // Focus the first item once it is drawn, for keyboard users.
      setTimeout(() => this.menuItems()[0]?.focus());
    }
  }

  private menuItems(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.imp-menu [role="menuitem"]'));
  }

  /** Up and down move through the menu; Escape closes it. */
  onMenuKey(event: KeyboardEvent): void {
    const items = this.menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Escape') {
      this.closeMenu(true);
    } else if (event.key === 'Tab') {
      this.closeMenu();
    }
  }

  closeMenu(refocus = false): void {
    this.menuOpen = false;

    if (refocus) {
      this.host.nativeElement.querySelector<HTMLElement>('.import-btn')?.focus();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.menuOpen && !this.host.nativeElement.querySelector('.imp-anchor')?.contains(event.target as Node)) {
      this.menuOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.editingRow !== null) {
      this.editingRow = null;
    } else if (this.step && this.step !== 'importing') {
      this.close();
    }
  }

  chooseFile(kind: FileKind): void {
    this.picking = kind;
    this.closeMenu();

    const input = this.fileInput?.nativeElement;

    if (input) {
      input.accept = kind === 'csv'
        ? '.csv,text/csv'
        : '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      input.value = '';
      input.click();
    }
  }

  /** Builds and downloads a template, with the person's own accounts in it. */
  async downloadTemplate(kind: TemplateKind, ext: 'csv' | 'xlsx'): Promise<void> {
    this.building = `${kind}-${ext}`;

    try {
      const [{ templateCsv, templateFileName, templateXlsx }, data] = await Promise.all([
        import('../../shared/import/templates'),
        firstValueFrom(forkJoin({
          accounts: this.balanceService.list(),
          expenseCategories: this.expenseService.listCategories(),
          incomeCategories: this.incomeService.listCategories()
        }))
      ]);
      const context = {
        today: localToday(),
        accounts: data.accounts.filter(a => a.saved).map(a => ({ name: a.category, type: a.type })),
        expenseCategories: data.expenseCategories,
        incomeCategories: data.incomeCategories
      };

      if (ext === 'csv') {
        const { headers, rows } = templateCsv(kind, context);
        downloadCsv(templateFileName(kind, 'csv'), headers, rows);
      } else {
        const bytes = templateXlsx(kind, context);
        const blob = new Blob([bytes as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = templateFileName(kind, 'xlsx');
        link.click();
        URL.revokeObjectURL(url);
      }

      this.closeMenu(true);
    } catch (error) {
      this.toast.error((error as ApiError)?.message ?? 'The sample file could not be made. Try again.');
    } finally {
      this.building = null;
    }
  }

  // ============================================================ reading the file

  async onFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';

    if (!chosen) {
      return;
    }

    this.reset();
    this.step = 'reading';
    this.status = `Reading ${chosen.name}…`;

    const problem = checkFile(chosen, this.picking);

    if (problem) {
      this.fail(problem);
      return;
    }

    try {
      const bytes = await this.readBytes(chosen);
      const kind = this.picking;

      this.status = 'Finding the columns…';

      const [hash, grid] = await Promise.all([
        sha256Hex(bytes),
        kind === 'csv'
          ? Promise.resolve(parseCsv(decodeText(bytes)))
          : import('../../shared/import/xlsx').then(m => m.readXlsx(bytes)).then(sheet => sheet.rows)
      ]);

      this.file = { name: chosen.name, kind, hash, size: chosen.size };
      this.table = buildTable(grid);
      this.columns = autoMap(this.table.headers);
      this.defaultKind = /income|credit|salary/i.test(chosen.name) ? 'income' : 'expense';

      // Example rows from a template go in only if the person keeps them.
      for (const raw of buildRawRows(this.table, this.columns)) {
        if (isSampleRow(raw)) {
          this.samples.add(raw.row);
          this.skipped.add(raw.row);
        }
      }

      if (mappingProblem(this.columns)) {
        this.step = 'map';
      } else {
        await this.runPreview();
      }
    } catch (error) {
      // ImportFileError and ZipError carry a sentence written to be shown;
      // an ApiError's message is already the server's own.
      this.fail((error as Error | ApiError)?.message || 'This file could not be read.');
    }
  }

  private readBytes(file: File): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onprogress = event => {
        if (event.lengthComputable) {
          this.readPercent = Math.round((event.loaded / event.total) * 100);
        }
      };
      reader.onload = () => {
        this.readPercent = 100;
        resolve(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.onerror = () => reject(new ImportFileError('This file could not be read. Try choosing it again.'));
      reader.readAsArrayBuffer(file);
    });
  }

  private fail(message: string): void {
    this.error = message;
    this.step = 'error';
  }

  // ============================================================ columns

  get mapProblem(): string | null {
    return mappingProblem(this.columns);
  }

  /** Amount is not needed when the file has separate money-out and money-in columns instead. */
  isRequired(field: ImportField): boolean {
    if (field === 'amount') {
      return this.columns.debit < 0 && this.columns.credit < 0;
    }

    return this.required.has(field);
  }

  get kindFromFile(): boolean {
    return kindFromColumns(this.columns);
  }

  columnLabel(index: number): string {
    const name = this.table?.headers[index] || 'No heading';
    let letters = '';

    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    }

    return `${letters} · ${name}`;
  }

  /** The first value under a field's column, as an example. */
  exampleFor(field: ImportField): string {
    const index = this.columns[field];

    if (index < 0 || !this.table) {
      return '';
    }

    const hit = this.table.rows.find(row => cellText(row.cells[index]) !== '');

    return hit ? cellText(hit.cells[index]).slice(0, 40) : '';
  }

  setColumn(field: ImportField, value: string | number): void {
    this.columns = { ...this.columns, [field]: Number(value) };
  }

  private columnsBefore: ColumnMap | null = null;

  /** From the review back to the columns, remembering them in case nothing changes. */
  editColumns(): void {
    this.columnsBefore = this.columns;
    this.editingRow = null;
    this.step = 'map';
  }

  /** Back to the review as it was, the columns unchanged. */
  cancelColumns(): void {
    this.columns = this.columnsBefore ?? this.columns;
    this.step = 'review';
  }

  async applyColumns(): Promise<void> {
    if (!this.mapProblem) {
      await this.runPreview();
    }
  }

  // ============================================================ preview

  /** The rows as the server should see them now: corrections and choices applied. */
  private rawRows(): RawRow[] {
    if (!this.table) {
      return [];
    }

    return buildRawRows(this.table, this.columns).map(raw => ({
      ...raw,
      account: raw.account || this.fallbackAccount,
      ...(this.edits.get(raw.row) ?? {}),
      skip: this.skipped.has(raw.row) || this.importedHere.has(raw.row),
      allowDuplicate: this.keptDuplicates.has(raw.row)
    }));
  }

  async runPreview(): Promise<void> {
    if (!this.file) {
      return;
    }

    if (this.step !== 'review') {
      this.step = 'reading';
      this.status = `Checking ${this.table?.rows.length.toLocaleString('en-IN')} rows…`;
      this.readPercent = 100;
    }

    this.checking = true;
    this.previewError = '';

    try {
      this.preview = await firstValueFrom(this.importService.preview(
        { defaultKind: this.defaultKind, updateBalances: this.updateBalances, fileHash: this.file.hash },
        this.rawRows()
      ));
      this.buildReview();
      this.step = 'review';
    } catch (error) {
      const message = (error as ApiError)?.message ?? 'The rows could not be checked.';

      if (this.step === 'review') {
        this.previewError = message;
      } else {
        this.fail(message);
      }
    } finally {
      this.checking = false;
    }
  }

  /** Re-checks shortly after a change, so several quick ticks cost one request. */
  private recheckSoon(): void {
    this.buildReview();

    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
    }

    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null;
      void this.runPreview();
    }, this.recheckDelayMs);
  }

  private buildReview(): void {
    this.review = (this.preview?.rows ?? []).map(p => {
      let state: RowState = p.status;

      if (this.importedHere.has(p.row)) {
        state = 'imported';
      } else if (this.skipped.has(p.row)) {
        state = this.samples.has(p.row) ? 'sample' : 'excluded';
      }

      const included = !this.importedHere.has(p.row) && !this.skipped.has(p.row) &&
        (p.status === 'ready' || (p.status === 'duplicate' && this.keptDuplicates.has(p.row)));

      return { p, state, included, toggleable: p.status !== 'invalid' && !this.importedHere.has(p.row) };
    });
  }

  get counts(): Record<ReviewFilter, number> {
    const counts = { all: 0, ready: 0, duplicate: 0, invalid: 0, excluded: 0 };

    for (const row of this.review) {
      counts.all += 1;

      if (row.state === 'ready') counts.ready += 1;
      else if (row.state === 'duplicate') counts.duplicate += 1;
      else if (row.state === 'invalid') counts.invalid += 1;
      else counts.excluded += 1;
    }

    return counts;
  }

  get visibleRows(): ReviewRow[] {
    if (this.filter === 'all') {
      return this.review;
    }

    if (this.filter === 'excluded') {
      return this.review.filter(row => ['excluded', 'sample', 'imported'].includes(row.state));
    }

    return this.review.filter(row => row.state === this.filter);
  }

  get includedCount(): number {
    return this.review.filter(row => row.included).length;
  }

  /** Rows whose only problem is a category the app does not have. */
  get unknownCategoryRows(): ReviewRow[] {
    return this.review.filter(row => row.state === 'invalid' &&
      row.p.errors.some(error => /is not an? (expense|income) category/.test(error)));
  }

  toggleRow(row: ReviewRow): void {
    const n = row.p.row;

    if (!row.toggleable) {
      return;
    }

    if (row.included) {
      this.skipped.add(n);
      this.keptDuplicates.delete(n);
    } else {
      this.skipped.delete(n);

      if (row.p.status === 'duplicate') {
        this.keptDuplicates.add(n);
      }
    }

    this.recheckSoon();
  }

  /** Puts an invalid row with the excluded ones, or brings it back. */
  setExcluded(row: ReviewRow, excluded: boolean): void {
    if (excluded) {
      this.skipped.add(row.p.row);
    } else {
      this.skipped.delete(row.p.row);
    }

    this.recheckSoon();
  }

  setFilter(filter: ReviewFilter): void {
    this.filter = filter;
    this.editingRow = null;
  }

  onKindChange(kind: DefaultKind): void {
    this.defaultKind = kind;

    if (this.step === 'review') {
      void this.runPreview();
    }
  }

  private blankAccounts = { table: null as ImportTable | null, columns: null as ColumnMap | null, value: false };

  /** True when some rows name no account, so a fallback account is worth offering. Cached per file and columns. */
  get hasBlankAccounts(): boolean {
    const cache = this.blankAccounts;

    if (cache.table !== this.table || cache.columns !== this.columns) {
      this.blankAccounts = {
        table: this.table,
        columns: this.columns,
        value: !!this.table && buildRawRows(this.table, this.columns).some(raw => !raw.account)
      };
    }

    return this.blankAccounts.value;
  }

  onFallbackChange(name: string): void {
    this.fallbackAccount = name;
    void this.runPreview();
  }

  onBalancesChange(value: boolean): void {
    this.updateBalances = value;
    void this.runPreview();
  }

  useOtherForUnknown(): void {
    for (const row of this.unknownCategoryRows) {
      this.edits.set(row.p.row, { ...(this.edits.get(row.p.row) ?? {}), category: 'Other' });
    }

    void this.runPreview();
  }

  // ------------------------------------------------------------ fixing a row

  private emptyDraft(): RawFields {
    return { date: '', description: '', amount: '', type: '', category: '', account: '', notes: '', paymentMethod: '' };
  }

  startEdit(row: ReviewRow): void {
    const raw = this.rawRows().find(r => r.row === row.p.row);

    if (!raw) {
      return;
    }

    this.editingRow = row.p.row;
    this.draftKind = row.p.kind ?? (this.defaultKind === 'income' ? 'income' : 'expense');
    this.draft = {
      date: row.p.date ?? raw.date,
      description: raw.description,
      amount: row.p.amountPaise !== null ? String(row.p.amountPaise / 100) : raw.amount,
      type: this.draftKind === 'income' ? 'Income' : 'Expense',
      category: row.p.category ?? raw.category,
      account: row.p.accountName ?? raw.account,
      notes: raw.notes,
      paymentMethod: raw.paymentMethod
    };
  }

  setDraftKind(kind: 'expense' | 'income'): void {
    this.draftKind = kind;
    this.draft = { ...this.draft, type: kind === 'income' ? 'Income' : 'Expense' };
  }

  /** The draft's category if it is not on the list, so the menu can still show it. */
  get draftCategoryUnknown(): boolean {
    const list = this.draftKind === 'income'
      ? this.preview?.options.incomeCategories
      : this.preview?.options.expenseCategories;

    return !!this.draft.category && !(list ?? []).includes(this.draft.category);
  }

  get draftAccountUnknown(): boolean {
    return !!this.draft.account && !(this.preview?.options.accounts ?? []).some(a => a.name === this.draft.account);
  }

  saveEdit(): void {
    if (this.editingRow === null) {
      return;
    }

    this.edits.set(this.editingRow, { ...this.draft });
    this.skipped.delete(this.editingRow);
    this.editingRow = null;
    void this.runPreview();
  }

  // ============================================================ confirming and importing

  goConfirm(): void {
    if (this.includedCount && !this.checking) {
      this.editingRow = null;
      this.step = 'confirm';
    }
  }

  backToReview(): void {
    this.step = 'review';
  }

  async startImport(): Promise<void> {
    if (!this.file || !this.table || !this.preview) {
      return;
    }

    const byRow = new Map(this.rawRows().map(raw => [raw.row, raw]));
    const going = this.review
      .filter(row => row.included)
      .sort((a, b) =>
        (a.p.date ?? '') !== (b.p.date ?? '') ? ((a.p.date ?? '') < (b.p.date ?? '') ? -1 : 1)
          : a.p.kind !== b.p.kind ? (a.p.kind === 'income' ? -1 : 1)
            : a.p.row - b.p.row)
      .map(row => {
        const { skip: _skip, ...raw } = byRow.get(row.p.row)!;
        return { ...raw, allowDuplicate: row.p.status === 'duplicate' };
      });

    const notGoing = this.review.filter(row => !row.included);
    const earlier = notGoing.filter(row => row.state === 'imported');
    const rest = notGoing.filter(row => row.state !== 'imported');
    this.planned = {
      ready: going.length,
      duplicates: rest.filter(row => row.p.status === 'duplicate').length,
      invalid: rest.filter(row => row.p.status === 'invalid').length,
      leftOut: rest.filter(row => row.p.status === 'ready').length,
      samples: rest.filter(row => row.p.status === 'ready' && row.state === 'sample').length,
      earlier: earlier.length
    };
    this.queue = [];

    for (let i = 0; i < going.length; i += CHUNK_SIZE) {
      this.queue.push(going.slice(i, i + CHUNK_SIZE));
    }

    this.batchId = crypto.randomUUID();
    this.chunkIndex = 0;
    this.importedCount = 0;
    this.failures = [];
    this.notAttempted = 0;
    this.budgetAlerts = [];
    this.progress = { done: 0, total: going.length };
    this.step = 'importing';

    await this.runQueue();
  }

  /** Sends the remaining chunks in order; stops at one that keeps failing. */
  async runQueue(): Promise<void> {
    this.chunkError = '';

    while (this.chunkIndex < this.queue.length) {
      const chunk = this.queue[this.chunkIndex];
      const result = await this.sendChunk(chunk);

      if (!result) {
        return;
      }

      this.record(chunk, result);
      this.chunkIndex += 1;
    }

    this.finish();
  }

  private async sendChunk(chunk: RawRow[]): Promise<ChunkResult | null> {
    const file = this.file!;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await firstValueFrom(this.importService.importChunk(
          this.batchId,
          { fileName: file.name, fileHash: file.hash, fileType: file.kind, totalRows: this.table!.rows.length },
          { defaultKind: this.defaultKind, updateBalances: this.updateBalances },
          chunk
        ));
      } catch (error) {
        const apiError = error as ApiError;

        // The same batch id makes a resend safe: rows already in are not added again.
        if (RETRYABLE.has(apiError?.status) && attempt < 3) {
          await wait(attempt * this.retryDelayMs);
          continue;
        }

        this.chunkError = apiError?.message ?? 'The import stopped.';
        return null;
      }
    }
  }

  private record(chunk: RawRow[], result: ChunkResult): void {
    const byRow = new Map(chunk.map(raw => [raw.row, raw]));

    for (const outcome of result.results) {
      if (outcome.status === 'imported') {
        this.importedCount += 1;
        this.importedHere.add(outcome.row);
      } else {
        this.failures.push({
          row: outcome.row,
          description: byRow.get(outcome.row)?.description ?? '',
          error: outcome.error ?? 'Not imported.'
        });
      }
    }

    this.budgetAlerts.push(...result.budgetAlerts.map(alert => alert.message));
    this.progress = { ...this.progress, done: Math.min(this.progress.total, this.progress.done + chunk.length) };
  }

  /** Gives up on what is left after a chunk keeps failing. */
  stopImport(): void {
    this.notAttempted = this.queue.slice(this.chunkIndex).reduce((sum, chunk) => sum + chunk.length, 0);
    this.finish();
  }

  private finish(): void {
    this.chunkError = '';
    this.step = 'report';

    if (this.importedCount) {
      this.imported.emit();
    }

    if (this.importedCount && !this.failures.length && !this.notAttempted) {
      this.toast.success(`${this.importedCount} transaction${this.importedCount === 1 ? '' : 's'} imported.`);
    }
  }

  /** Back to the review with what is left, re-checked against what was just imported. */
  async fixFailed(): Promise<void> {
    this.filter = 'all';
    this.preview = null;
    await this.runPreview();

    if (this.counts.invalid) {
      this.filter = 'invalid';
    }
  }

  downloadFailed(): void {
    if (!this.table || !this.failures.length) {
      return;
    }

    const failed = new Map(this.failures.map(failure => [failure.row, failure.error]));
    const rows = this.table.rows
      .filter(row => failed.has(row.row))
      .map(row => [String(row.row), ...this.table!.headers.map((_, i) => cellText(row.cells[i])), failed.get(row.row)!]);

    downloadCsv(
      `${this.file!.name.replace(/\.[^.]+$/, '')}-not-imported.csv`,
      ['Row', ...this.table.headers.map((header, i) => header || `Column ${i + 1}`), 'Why it was not imported'],
      rows
    );
  }

  // ============================================================ closing

  close(): void {
    if (this.step === 'importing') {
      return;
    }

    this.step = null;
    this.reset();
  }

  /** Picks another file of the same kind. */
  chooseAgain(): void {
    this.chooseFile(this.file?.kind ?? this.picking);
  }

  private reset(): void {
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }

    this.error = '';
    this.status = '';
    this.readPercent = 0;
    this.file = null;
    this.table = null;
    this.columns = autoMap([]);
    this.edits = new Map();
    this.skipped = new Set();
    this.keptDuplicates = new Set();
    this.samples = new Set();
    this.importedHere = new Set();
    this.preview = null;
    this.review = [];
    this.previewError = '';
    this.filter = 'all';
    this.editingRow = null;
    this.updateBalances = true;
    this.fallbackAccount = '';
    this.failures = [];
    this.importedCount = 0;
    this.notAttempted = 0;
    this.budgetAlerts = [];
    this.chunkError = '';
  }

  // ============================================================ display

  rupees(paise: number | null): string {
    if (paise === null) {
      return '—';
    }

    // Paise show as two digits (₹1,450.50), whole rupees as none (₹250).
    const digits = paise % 100 === 0 ? 0 : 2;

    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  /** The amount with − for money out and + for money in, or — when it could not be read. */
  rowAmount(p: PreviewRow): string {
    if (p.amountPaise === null) {
      return '—';
    }

    return `${p.kind === 'income' ? '+' : p.kind === 'expense' ? '−' : ''}${this.rupees(p.amountPaise)}`;
  }

  signedRupees(paise: number): string {
    return `${paise < 0 ? '−' : '+'}${this.rupees(Math.abs(paise))}`;
  }

  shortDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${iso}T00:00:00Z`));
  }

  /** Why a row is where it is, in one line, for rows that are not simply ready. */
  stateNote(row: ReviewRow): string {
    switch (row.state) {
      case 'duplicate': {
        const of = row.p.duplicateOf;

        if (!of) return '';

        return of.source === 'file'
          ? `Same as row ${of.row} in this file.`
          : `Already in Transactions: ${of.description}, ${this.shortDate(of.date)}.`;
      }
      case 'sample':
        return 'An example row from the template.';
      case 'imported':
        return 'Imported.';
      case 'excluded':
        return 'Left out.';
      default:
        return '';
    }
  }

  readonly stateLabel: Record<RowState, string> = {
    ready: 'Ready',
    duplicate: 'Duplicate',
    invalid: 'Needs fixing',
    excluded: 'Left out',
    sample: 'Example',
    imported: 'Imported'
  };

  get stepNumber(): number {
    return { reading: 1, error: 1, map: 1, review: 2, confirm: 3, importing: 3, report: 4 }[this.step ?? 'reading'];
  }

  get title(): string {
    switch (this.step) {
      case 'map': return 'Match the columns';
      case 'review': return 'Check before importing';
      case 'confirm': return 'Import these transactions?';
      case 'importing': return 'Importing';
      case 'report': return this.failures.length || this.notAttempted ? 'Import finished, with problems' : 'Import finished';
      case 'error': return 'This file cannot be imported';
      default: return 'Reading the file';
    }
  }

}
