import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TransactionImportComponent } from './transaction-import.component';
import { PreviewResponse, PreviewRow } from '../../shared/import.service';
import { RawRow } from '../../shared/import/import-file';
import { templateCsvText, templateXlsx } from '../../shared/import/templates';

/** Waits for the component's promises to reach a condition. */
async function until(check: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for ${what}`);
}

type Matcher = string | ((req: import('@angular/common/http').HttpRequest<unknown>) => boolean);

/** Waits for a request and takes it (match() removes what it returns, so it cannot be used to peek). */
async function nextRequest(http: HttpTestingController, matcher: Matcher, what = 'a request'): Promise<TestRequest> {
  for (let i = 0; i < 400; i += 1) {
    const found = http.match(matcher as never);
    if (found.length) return found[0];
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for ${what}`);
}

const ROWS = (req: import('@angular/common/http').HttpRequest<unknown>) => /\/api\/imports\/[0-9a-f-]{36}\/rows$/.test(req.url);

/** A stand-in for the server's preview: Bad is invalid, Dup is a duplicate, the rest are ready. */
function previewFor(rows: RawRow[]): PreviewResponse {
  const checked: PreviewRow[] = rows.map(raw => {
    const status = raw.description === 'Bad' ? 'invalid' : raw.description.startsWith('Dup') ? 'duplicate' : 'ready';
    const kind = /income/i.test(raw.type) ? 'income' : 'expense';

    return {
      row: raw.row,
      status,
      kind,
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null,
      amountPaise: Math.round(Number(raw.amount) * 100) || null,
      description: raw.description,
      category: raw.category || null,
      accountId: raw.account ? 'a1' : null,
      accountName: raw.account || null,
      notes: raw.notes,
      paymentMethod: raw.paymentMethod,
      settle: 'done',
      moves: raw.account ? (kind === 'income' ? 'credit' : 'debit') : null,
      errors: status === 'invalid' ? ['"Fuel" is not an expense category.'] : [],
      info: [],
      duplicateOf: status === 'duplicate' ? { source: 'existing', date: raw.date, description: raw.description } : null
    };
  });
  const going = checked.filter((row, i) => !rows[i].skip &&
    (row.status === 'ready' || (row.status === 'duplicate' && rows[i].allowDuplicate)));

  return {
    rows: checked,
    summary: {
      total: checked.length,
      ready: checked.filter(r => r.status === 'ready').length,
      duplicates: checked.filter(r => r.status === 'duplicate').length,
      invalid: checked.filter(r => r.status === 'invalid').length,
      excluded: rows.filter(r => r.skip).length,
      toImport: going.length,
      expenses: { count: going.filter(r => r.kind === 'expense').length, paise: 0 },
      incomes: { count: going.filter(r => r.kind === 'income').length, paise: 0 },
      pending: 0,
      accounts: [{ name: 'HDFC Bank', changePaise: -25000 }]
    },
    previousImports: [],
    options: {
      expenseCategories: ['Food & Drink', 'Other'],
      incomeCategories: ['Salary', 'Other'],
      accounts: [{ id: 'a1', name: 'HDFC Bank', type: 'Bank Account' }]
    },
    canSeeBalances: true
  };
}

const CONTEXT = {
  today: '2026-11-10',
  accounts: [{ name: 'HDFC Bank', type: 'Bank Account' }],
  expenseCategories: ['Food & Drink', 'Groceries', 'Bills & Utilities', 'Other'],
  incomeCategories: ['Salary', 'Refund', 'Business', 'Other']
};

describe('TransactionImportComponent', () => {
  let fixture: ComponentFixture<TransactionImportComponent>;
  let component: TransactionImportComponent;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransactionImportComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TransactionImportComponent);
    component = fixture.componentInstance;
    component.retryDelayMs = 0;
    component.recheckDelayMs = 0;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /** Chooses a file as the file picker would. */
  function choose(file: File, kind: 'csv' | 'xlsx' = 'csv'): Promise<void> {
    component.picking = kind;
    return component.onFileChosen({ target: { files: [file], value: '' } } as unknown as Event);
  }

  function csv(text: string, name = 'november.csv'): File {
    return new File([text], name, { type: 'text/csv' });
  }

  /** Answers the next preview with the stand-in, and returns what was asked. */
  async function answerPreview(): Promise<{ rows: RawRow[]; request: TestRequest }> {
    const request = await nextRequest(http, '/api/imports/preview', 'a preview request');
    const rows = request.request.body.rows as RawRow[];
    request.flush(previewFor(rows));
    await until(() => !component.checking, 'the preview to finish');
    fixture.detectChanges();
    return { rows, request };
  }

  async function openReview(text: string): Promise<RawRow[]> {
    const done = choose(csv(text));
    const { rows } = await answerPreview();
    await done;
    fixture.detectChanges();
    return rows;
  }

  const FILE = [
    'Date,Description,Amount,Category,Account,Notes,Payment Method',
    '2026-11-03,Lunch,250,Food & Drink,HDFC Bank,Team lunch,Card',
    '2026-11-02,Dup coffee,20,,,,',
    '2026-11-04,Bad,10,Fuel,,,'
  ].join('\n');

  describe('the menu', () => {
    it('offers CSV and Excel imports and the three sample files, each in both formats', () => {
      el.querySelector<HTMLButtonElement>('.import-btn')!.click();
      fixture.detectChanges();

      const menu = el.querySelector('[role="menu"]')!;
      expect(menu.textContent).toContain('Import CSV');
      expect(menu.textContent).toContain('Import Excel (.xlsx)');
      expect(menu.textContent).toContain('Expense template');
      expect(menu.textContent).toContain('Income template');
      expect(menu.textContent).toContain('Expense + Income');
      expect(menu.querySelectorAll('.imp-fmt').length).toBe(6);
      expect(el.querySelector('.import-btn')!.getAttribute('aria-expanded')).toBe('true');
    });

    it('closes on Escape and on a click elsewhere', () => {
      component.toggleMenu();
      fixture.detectChanges();
      component.onMenuKey(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(component.menuOpen).toBeFalse();

      component.toggleMenu();
      component.onDocumentClick({ target: document.body } as unknown as MouseEvent);
      expect(component.menuOpen).toBeFalse();
    });

    it('downloads a sample file built from the accounts and categories', async () => {
      const click = spyOn(HTMLAnchorElement.prototype, 'click');
      const made = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
      spyOn(URL, 'revokeObjectURL');

      const done = component.downloadTemplate('combined', 'xlsx');
      http.expectOne('/api/balances').flush([
        { id: 'a1', type: 'Bank Account', category: 'HDFC Bank', balance: 10, saved: true, hidden: false },
        { id: 'a2', type: 'Wallet', category: 'Draft', balance: 0, saved: false, hidden: false }
      ]);
      http.expectOne('/api/expenses/categories').flush(CONTEXT.expenseCategories);
      http.expectOne('/api/incomes/categories').flush(CONTEXT.incomeCategories);
      await done;

      const blob = made.calls.mostRecent().args[0] as Blob;
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect((click.calls.mostRecent().object as HTMLAnchorElement).download).toBe('expense-and-income-import-template.xlsx');
      expect(component.building).toBeNull();
    });
  });

  describe('choosing a file', () => {
    it('refuses the wrong type with a reason and sends nothing', async () => {
      await choose(new File(['x'], 'statement.pdf'));
      fixture.detectChanges();

      expect(component.step).toBe('error');
      expect(el.querySelector('[role="alert"]')!.textContent).toContain('not a CSV or .xlsx');
    });

    it('refuses an empty file and a file with only headings', async () => {
      await choose(new File([], 'empty.csv'));
      expect(component.error).toContain('empty');

      await choose(csv('Date,Description,Amount\n'));
      expect(component.error).toContain('no transactions');
    });

    it('sends every row with its raw cells and a hash of the file', async () => {
      const rows = await openReview(FILE);

      expect(rows.length).toBe(3);
      expect(rows[0]).toEqual(jasmine.objectContaining({
        row: 2, date: '2026-11-03', description: 'Lunch', amount: '250', category: 'Food & Drink',
        account: 'HDFC Bank', notes: 'Team lunch', paymentMethod: 'Card', skip: false, allowDuplicate: false
      }));
      expect(component.file!.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(component.step).toBe('review');
    });

    it('asks which column is which when the headings are not recognised', async () => {
      await choose(csv('When,What,Rupees\n2026-11-05,Tea,20'));
      fixture.detectChanges();

      expect(component.step).toBe('map');
      expect(el.textContent).toContain('Choose the column with the date.');

      component.setColumn('date', 0);
      component.setColumn('description', 1);
      component.setColumn('amount', 2);
      fixture.detectChanges();
      expect(component.mapProblem).toBeNull();

      const done = component.applyColumns();
      const { rows } = await answerPreview();
      await done;
      expect(rows[0]).toEqual(jasmine.objectContaining({ date: '2026-11-05', description: 'Tea', amount: '20' }));
    });

    it('reads an Excel file the same way, leaving its example rows out', async () => {
      const bytes = templateXlsx('expense', CONTEXT);
      const done = choose(new File([bytes as BlobPart], 'expense-import-template.xlsx'), 'xlsx');
      const { rows } = await answerPreview();
      await done;

      expect(rows.length).toBe(3);
      expect(rows.every(row => row.skip)).withContext('example rows start left out').toBeTrue();
      expect(component.review.every(row => row.state === 'sample')).toBeTrue();
    });
  });

  describe('the review', () => {
    it('shows each row with its state and reasons', async () => {
      await openReview(FILE);

      expect(component.counts).toEqual({ all: 3, ready: 1, duplicate: 1, invalid: 1, excluded: 0 });
      expect(el.textContent).toContain('"Fuel" is not an expense category.');
      expect(el.textContent).toContain('Already in Transactions');
      expect(component.includedCount).toBe(1);
    });

    it('leaves the template example rows out unless kept', async () => {
      const rows = await openReview(templateCsvText('income', CONTEXT));

      expect(rows.every(row => row.skip)).toBeTrue();
      expect(component.includedCount).toBe(0);

      component.toggleRow(component.review[0]);
      const { rows: again } = await answerPreview();
      expect(again[0].skip).toBeFalse();
      expect(component.includedCount).toBe(1);
    });

    it('imports a duplicate only when the person ticks it', async () => {
      await openReview(FILE);

      const dup = component.review.find(row => row.state === 'duplicate')!;
      expect(dup.included).toBeFalse();

      component.toggleRow(dup);
      const { rows } = await answerPreview();

      expect(rows.find(row => row.row === 3)!.allowDuplicate).toBeTrue();
      expect(component.review.find(row => row.p.row === 3)!.included).toBeTrue();
    });

    it('fixes an invalid row and checks it again', async () => {
      await openReview(FILE);
      const bad = component.review.find(row => row.state === 'invalid')!;

      component.startEdit(bad);
      fixture.detectChanges();
      expect(el.querySelector('.imp-edit')).not.toBeNull();

      component.draft = { ...component.draft, description: 'Petrol', category: 'Other' };
      component.saveEdit();
      const { rows } = await answerPreview();

      expect(rows.find(row => row.row === 4)).toEqual(jasmine.objectContaining({ description: 'Petrol', category: 'Other' }));
      expect(component.review.find(row => row.p.row === 4)!.state).toBe('ready');
    });

    it('can leave an invalid row out and bring it back', async () => {
      await openReview(FILE);
      const bad = component.review.find(row => row.state === 'invalid')!;

      component.setExcluded(bad, true);
      expect(component.review.find(row => row.p.row === 4)!.state).toBe('excluded');
      await answerPreview();

      component.setExcluded(component.review.find(row => row.p.row === 4)!, false);
      await answerPreview();
      expect(component.review.find(row => row.p.row === 4)!.state).toBe('invalid');
    });

    it('files every unknown category under Other in one go', async () => {
      await openReview(FILE);
      component.setFilter('invalid');
      fixture.detectChanges();
      expect(el.textContent).toContain('File them under Other');

      component.useOtherForUnknown();
      const { rows } = await answerPreview();
      expect(rows.find(row => row.row === 4)!.category).toBe('Other');
    });

    it('can give every row with no account one account, as a bank statement needs', async () => {
      await openReview(FILE);
      expect(component.hasBlankAccounts).toBeTrue();

      component.onFallbackChange('HDFC Bank');
      const { rows } = await answerPreview();

      expect(rows.find(row => row.row === 2)!.account).toBe('HDFC Bank');
      expect(rows.find(row => row.row === 3)!.account).toBe('HDFC Bank');
      expect(rows.find(row => row.row === 4)!.account).toBe('HDFC Bank');
    });

    it('re-checks with balances left alone when the switch is turned off', async () => {
      await openReview(FILE);

      component.onBalancesChange(false);
      const { request } = await answerPreview();

      expect(request.request.body.updateBalances).toBeFalse();
      expect(el.textContent).toContain('no money moves');
    });

    it('asks for confirmation, with the totals and balance changes, before importing', async () => {
      await openReview(FILE);

      component.goConfirm();
      fixture.detectChanges();

      expect(component.step).toBe('confirm');
      expect(el.textContent).toContain('1 expense');
      expect(el.textContent).toContain('HDFC Bank');
      expect(el.textContent).toContain('Nothing already in Transactions is changed.');
      http.expectNone(req => req.url.includes('/rows'));
    });
  });

  describe('importing', () => {
    /** A file of `count` ready rows, newest first so the order has to be fixed. */
    function bigFile(count: number): string {
      const lines = ['Date,Description,Amount'];

      for (let i = 0; i < count; i += 1) {
        const day = String(28 - (i % 28)).padStart(2, '0');
        lines.push(`2026-10-${day},Item ${i},${i + 1}`);
      }

      return lines.join('\n');
    }

    async function answerChunk(fail: number[] = []): Promise<RawRow[]> {
      const request = await nextRequest(http, ROWS, 'a chunk');
      const rows = request.request.body.rows as RawRow[];
      request.flush({
        results: rows.map(row => fail.includes(row.row)
          ? { row: row.row, status: 'failed', kind: 'expense', error: 'Insufficient balance.' }
          : { row: row.row, status: 'imported', kind: 'expense' }),
        batch: { importedRows: 0, failedRows: 0 },
        budgetAlerts: []
      });
      return rows;
    }

    it('sends the rows in chunks of 50, oldest first, under one import id, and reports the result', async () => {
      await openReview(bigFile(230));
      const emitted = spyOn(component.imported, 'emit');

      component.goConfirm();
      const done = component.startImport();

      const sent: RawRow[] = [];
      const urls = new Set<string>();

      for (let chunk = 0; chunk < 5; chunk += 1) {
        const request = await nextRequest(http, ROWS, `chunk ${chunk}`);
        urls.add(request.request.url);
        const rows = request.request.body.rows as RawRow[];
        sent.push(...rows);
        expect(rows.every(row => !('skip' in row))).toBeTrue();
        request.flush({
          results: rows.map(row => row.row === 5
            ? { row: row.row, status: 'failed', kind: 'expense', error: 'Insufficient balance.' }
            : { row: row.row, status: 'imported', kind: 'expense' }),
          batch: { importedRows: 0, failedRows: 0 },
          budgetAlerts: []
        });
      }

      await done;
      fixture.detectChanges();

      expect(sent.length).toBe(230);
      expect(urls.size).toBe(1);
      expect(component.planned).toEqual(jasmine.objectContaining({ ready: 230, duplicates: 0, invalid: 0, leftOut: 0 }));
      const dates = sent.map(row => row.date);
      expect([...dates].sort()).toEqual(dates);

      expect(component.step).toBe('report');
      expect(component.importedCount).toBe(229);
      expect(component.failures).toEqual([{ row: 5, description: 'Item 3', error: 'Insufficient balance.' }]);
      expect(el.textContent).toContain('Not imported');
      expect(el.textContent).toContain('Insufficient balance.');
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('sends a chunk again after a server hiccup, under the same import id', async () => {
      await openReview(bigFile(3));
      const done = component.startImport();

      const first = await nextRequest(http, ROWS);
      const url = first.request.url;
      first.flush({ error: 'busy' }, { status: 503, statusText: 'Unavailable' });

      const retry = await nextRequest(http, ROWS, 'the retry');
      expect(retry.request.url).toBe(url);
      const rows = retry.request.body.rows as RawRow[];
      retry.flush({
        results: rows.map(row => ({ row: row.row, status: 'imported', kind: 'expense' })),
        batch: { importedRows: 3, failedRows: 0 },
        budgetAlerts: []
      });
      await done;

      expect(rows.length).toBe(3);
      expect(component.importedCount).toBe(3);
    });

    it('stops on a refusal, says so, and can be stopped there with what is left counted', async () => {
      await openReview(bigFile(150));
      const done = component.startImport();

      await answerChunk();

      (await nextRequest(http, ROWS))
        .flush({ error: 'Send at most 100 rows at a time.' }, { status: 400, statusText: 'Bad' });
      await done;
      fixture.detectChanges();

      expect(component.chunkError).toContain('100 rows');
      expect(el.textContent).toContain('Trying again is safe');

      component.stopImport();
      fixture.detectChanges();
      expect(component.step).toBe('report');
      expect(component.notAttempted).toBe(100);
      expect(el.textContent).toContain('100 rows were not attempted');
    });

    it('reports every row in exactly one place: imported, duplicate, invalid or left out', async () => {
      await openReview(FILE);
      const done = component.startImport();
      await answerChunk();
      await done;
      fixture.detectChanges();

      // Lunch goes in; the coffee is a duplicate; Bad is invalid.
      expect(component.planned).toEqual({ ready: 1, duplicates: 1, invalid: 1, leftOut: 0, samples: 0, earlier: 0 });
      const stats = Array.from(el.querySelectorAll('.imp-stats dd')).map(dd => dd.textContent!.trim());
      expect(stats).toEqual(['3', '1', '1', '1', '1', '0']);
    });

    it('goes back to the review with imported rows set aside, to fix what failed', async () => {
      await openReview(FILE);
      const done = component.startImport();
      await answerChunk();
      await done;

      const again = component.fixFailed();
      const { rows } = await answerPreview();
      await again;

      expect(rows.find(row => row.row === 2)!.skip).toBeTrue();
      expect(component.review.find(row => row.p.row === 2)!.state).toBe('imported');
    });

    it('cannot be closed while importing', async () => {
      await openReview(FILE);
      const done = component.startImport();
      fixture.detectChanges();

      component.close();
      expect(component.step).toBe('importing');

      await answerChunk();
      await done;
    });
  });
});
