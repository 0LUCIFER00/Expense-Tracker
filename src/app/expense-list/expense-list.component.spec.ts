import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { ExpenseListComponent, TransactionTab } from './expense-list.component';
import { DEFAULT_SETTINGS, Expense, Income, Settings, SplitSummary } from '../shared/models';
import { UNCATEGORISED } from '../shared/expense.service';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    amount: 100,
    description: 'Coffee',
    date: '2026-10-20',
    category: 'Food & Drink',
    sourceId: 'b1',
    sourceType: 'Wallet',
    sourceCategory: 'Paytm',
    expenseAccess: true,
    updatePermission: true,
    balanceUpdated: true,
    status: 'Done',
    remarks: 'Added in list',
    isPendingApproval: false,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides
  };
}

describe('ExpenseListComponent', () => {
  let component: ExpenseListComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ExpenseListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Builds the component with a given list already loaded. */
  function load(
    expenses: Expense[],
    settings: Partial<Settings> = {},
    splits: SplitSummary[] = [],
    incomes: Income[] = []
  ) {
    const fixture = TestBed.createComponent(ExpenseListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne('/api/expenses').flush(expenses);
    http.expectOne('/api/incomes').flush(incomes);
    http.expectOne('/api/expenses/splits').flush(splits);
    http.expectOne('/api/settings').flush({ ...DEFAULT_SETTINGS, ...settings });

    fixture.detectChanges();
    return fixture;
  }

  function income(overrides: Partial<Income> = {}): Income {
    return {
      id: 'i1',
      amount: 50000,
      description: 'October salary',
      date: '2026-10-20',
      category: 'Salary',
      targetId: 'b1',
      targetType: 'Bank Account',
      targetCategory: 'HDFC Bank',
      balanceUpdated: true,
      createdAt: '2026-10-20T11:00:00.000Z',
      splitExpenseId: null,
      splitDescription: null,
      ...overrides
    };
  }

  describe('the default order', () => {
    it('puts the latest entry first, money in and out together', () => {
      load(
        [
          expense({ id: 'old', createdAt: '2026-10-01T09:00:00.000Z', date: '2026-10-01' }),
          // Entered last, though dated earlier than the others.
          expense({ id: 'newest', createdAt: '2026-11-08T18:00:00.000Z', date: '2026-09-15' })
        ],
        {},
        [],
        [income({ id: 'mid', createdAt: '2026-10-20T11:00:00.000Z' })]
      );

      expect(component.rows.map(row => row.key)).toEqual(['out:newest', 'in:mid', 'out:old']);
    });
  });

  describe('the category filter', () => {
    it('offers only the categories actually in use', () => {
      load([
        expense({ id: 'e1', category: 'Travel' }),
        expense({ id: 'e2', category: 'Food & Drink' }),
        expense({ id: 'e3', category: 'Travel' })
      ]);

      expect(component.usedCategories).toEqual(['Food & Drink', 'Travel']);
    });

    it('offers the uncategorised bucket when something is in it', () => {
      load([expense({ id: 'e1', category: null }), expense({ id: 'e2', category: 'Travel' })]);

      expect(component.usedCategories).toEqual(['Travel', UNCATEGORISED]);
    });

    it('narrows the list and the total to one category', () => {
      load([
        expense({ id: 'e1', category: 'Travel', amount: 300 }),
        expense({ id: 'e2', category: 'Food & Drink', amount: 100 })
      ]);

      component.selectedCategory = 'Travel';
      component.applyFilters();

      expect(component.expenses.map(e => e.id)).toEqual(['e1']);
      expect(component.total).toBe(300);
    });

    it('matches the uncategorised bucket against entries with no category', () => {
      load([
        expense({ id: 'e1', category: null, amount: 40 }),
        expense({ id: 'e2', category: 'Travel', amount: 300 })
      ]);

      component.selectedCategory = UNCATEGORISED;
      component.applyFilters();

      expect(component.expenses.map(e => e.id)).toEqual(['e1']);
    });
  });

  describe('receipts', () => {
    it('shows a paperclip with the count on expenses that have attachments, and none otherwise', () => {
      const fixture = load([
        expense({ id: 'with', attachmentCount: 3 }),
        expense({ id: 'without', attachmentCount: 0 })
      ]);
      const clips = (fixture.nativeElement as HTMLElement).querySelectorAll('.et-clip');

      expect(clips.length).toBe(1);
      expect(clips[0].textContent).toContain('3');
    });

    it('clicking any expense row opens its details, receipts included', () => {
      const fixture = load([expense({ id: 'e1', description: 'Lunch' })]);
      const row = (fixture.nativeElement as HTMLElement).querySelector('.table-row') as HTMLElement;

      row.click();
      fixture.detectChanges();

      expect(component.openRow?.expense?.id).toBe('e1');
      http.expectOne('/api/expenses/e1/attachments').flush([]);
      fixture.detectChanges();

      const drawer = (fixture.nativeElement as HTMLElement).querySelector('app-transaction-details') as HTMLElement;
      expect(drawer.textContent).toContain('Lunch');
      expect(drawer.textContent).toContain('Receipts & invoices');
    });

    it('opens from the keyboard too, and closes again', () => {
      const fixture = load([expense({ id: 'e1' })]);
      const row = (fixture.nativeElement as HTMLElement).querySelector('.table-row') as HTMLElement;

      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');

      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      http.expectOne('/api/expenses/e1/attachments').flush([]);
      fixture.detectChanges();

      expect(component.openRow?.key).toBe('out:e1');

      ((fixture.nativeElement as HTMLElement).querySelector('.drawer .close') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(component.openRow).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('app-transaction-details')).toBeNull();
    });

    it('opens money in as well, with no receipts section', () => {
      const fixture = load([], {}, [], [income({ id: 'i1', description: 'October salary' })]);
      ((fixture.nativeElement as HTMLElement).querySelector('.table-row') as HTMLElement).click();
      fixture.detectChanges();

      const drawer = (fixture.nativeElement as HTMLElement).querySelector('app-transaction-details') as HTMLElement;
      expect(drawer.textContent).toContain('October salary');
      expect(drawer.textContent).toContain('+₹50,000');
      expect(drawer.textContent).not.toContain('Receipts');
    });

    it('removes only after the drawer asks, then refunds and reloads as before', () => {
      const fixture = load([expense({ id: 'e1', amount: 250, sourceCategory: 'Paytm' })]);
      ((fixture.nativeElement as HTMLElement).querySelector('.table-row') as HTMLElement).click();
      fixture.detectChanges();
      http.expectOne('/api/expenses/e1/attachments').flush([]);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      (el.querySelector('.foot .btn.danger') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Asking, not yet removed.
      http.expectNone(req => req.method === 'DELETE');
      expect(el.querySelector('.foot')!.textContent).toContain('Removing puts ₹250 back in Paytm.');

      (el.querySelector('.foot .btn.danger-solid') as HTMLButtonElement).click();
      fixture.detectChanges();

      http.expectOne(req => req.method === 'DELETE' && req.url === '/api/expenses/e1')
        .flush({ id: 'e1', refunded: true, sourceCategory: 'Paytm' });
      expect(component.openRow).toBeNull();

      // The reload after removing.
      http.expectOne('/api/expenses').flush([]);
      http.expectOne('/api/incomes').flush([]);
      http.expectOne('/api/expenses/splits').flush([]);
      http.expectOne('/api/settings').flush(DEFAULT_SETTINGS);
    });
  });

  describe('a split expense', () => {
    const vegetables: SplitSummary = {
      id: 's1',
      description: 'October Month Vegetables',
      date: '2026-11-03',
      status: 'done',
      amount: 1455,
      members: 4,
      share: 364,
      personal: 363,
      owed: 1092,
      received: 728,
      remaining: 364,
      repayments: [
        { id: 'i1', amount: 364, description: 'Kalai Oct Vegetables share', date: '2026-11-03', account: 'HDFC Bank' },
        { id: 'i2', amount: 364, description: 'Kamesh Oct Vegetables share', date: '2026-11-04', account: 'HDFC Bank' }
      ]
    };

    function loadWithSplit() {
      return load(
        [
          expense({ id: 's1', description: 'October Month Vegetables', amount: 1455, splitMembers: 4, personalShare: 363 }),
          expense({ id: 'e2', description: 'Coffee' })
        ],
        {},
        [vegetables]
      );
    }

    it('shows who has paid back in the details of the split expense', () => {
      const fixture = loadWithSplit();
      const rows = fixture.nativeElement.querySelectorAll('.table-row') as NodeListOf<HTMLElement>;

      rows[0].click();
      fixture.detectChanges();
      http.expectOne('/api/expenses/s1/attachments').flush([]);
      fixture.detectChanges();

      const drawer = fixture.nativeElement.querySelector('app-transaction-details') as HTMLElement;

      expect(drawer.textContent).toContain('Paid back');
      expect(drawer.textContent).toContain('Kalai Oct Vegetables share');
      expect(drawer.textContent).toContain('Kamesh Oct Vegetables share');
      expect(drawer.textContent).toContain('₹728 of ₹1,092');
      expect(drawer.textContent).toContain('Still to come');
    });

    it('an ordinary expense has no paid-back section', () => {
      const fixture = loadWithSplit();
      const rows = fixture.nativeElement.querySelectorAll('.table-row') as NodeListOf<HTMLElement>;

      rows[1].click();
      fixture.detectChanges();
      http.expectOne('/api/expenses/e2/attachments').flush([]);
      fixture.detectChanges();

      expect(component.openRow?.expense?.id).toBe('e2');
      expect(fixture.nativeElement.querySelector('app-transaction-details').textContent).not.toContain('Paid back');
    });

    it('counts only your share in the total at the top', () => {
      loadWithSplit();

      // ₹363 of the vegetables plus the ₹100 coffee.
      expect(component.total).toBe(463);
    });
  });

  describe('exporting CSV', () => {
    let href: string;
    let download: string;
    let blob: Blob | null;

    beforeEach(() => {
      href = '';
      download = '';
      blob = null;

      spyOn(URL, 'createObjectURL').and.callFake((value: Blob | MediaSource) => {
        blob = value as Blob;
        return 'blob:stub';
      });

      spyOn(URL, 'revokeObjectURL');

      // The anchor is created and clicked, never added to the document, so it
      // has to be intercepted at createElement.
      const realCreate = document.createElement.bind(document);

      spyOn(document, 'createElement').and.callFake((tag: string) => {
        const element = realCreate(tag);

        if (tag === 'a') {
          const anchor = element as HTMLAnchorElement;
          spyOn(anchor, 'click').and.callFake(() => {
            href = anchor.href;
            download = anchor.download;
          });
        }

        return element;
      });
    });

    /** Money out is the file the old View Expenses page wrote, so it is the default. */
    async function csvText(tab: TransactionTab = 'out'): Promise<string> {
      component.onTab(tab);
      component.onExportCsv();
      expect(blob).not.toBeNull();
      return (blob as Blob).text();
    }

    it('writes a header row and one row per expense on screen', async () => {
      load([
        expense({ id: 'e1', description: 'Coffee', amount: 100 }),
        expense({ id: 'e2', description: 'Bus', amount: 30, category: 'Travel' })
      ]);

      const rows = (await csvText()).split('\r\n');

      expect(rows.length).toBe(3);
      expect(rows[0]).toBe(
        'Date,Amount,Description,Category,Source Type,Account,Status,Remarks,' +
        'Split Between,Your Share'
      );
      expect(rows[1]).toContain('Coffee');
      expect(rows[2]).toContain('Bus');
    });

    it('exports what the filters left, not the whole list', async () => {
      load([
        expense({ id: 'e1', category: 'Travel' }),
        expense({ id: 'e2', category: 'Food & Drink' })
      ]);

      component.selectedCategory = 'Travel';
      component.applyFilters();

      const rows = (await csvText()).split('\r\n');

      expect(rows.length).toBe(2);
    });

    it('leaves out the source columns the account may not see', async () => {
      load([expense()], { viewPermissionUser: false });

      const header = (await csvText()).split('\r\n')[0];

      expect(header).toBe(
        'Date,Amount,Description,Category,Status,Remarks,Split Between,Your Share'
      );
      expect(header).not.toContain('Account');
    });

    it('writes how a split expense was divided, and leaves it blank otherwise', async () => {
      load([
        expense({ id: 'e1', description: 'Vegetables', amount: 1455, splitMembers: 4, personalShare: 363 }),
        expense({ id: 'e2', description: 'Coffee', amount: 100 })
      ]);

      const rows = (await csvText()).split('\r\n');

      expect(rows[1]).toMatch(/,4,363$/);
      expect(rows[2]).toMatch(/,,$/);
    });

    it('quotes a description containing a comma', async () => {
      load([expense({ description: 'Lunch, and coffee' })]);

      expect(await csvText()).toContain('"Lunch, and coffee"');
    });

    it('doubles a quote inside a description', async () => {
      load([expense({ description: 'The "usual"' })]);

      expect(await csvText()).toContain('"The ""usual"""');
    });

    it('starts with a BOM so Excel reads it as UTF-8', async () => {
      load([expense()]);
      await csvText();

      // Blob.text() decodes as UTF-8, and that strips the BOM — so the bytes
      // are what has to be checked here, not the decoded string.
      const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());

      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it('names the file after today', async () => {
      load([expense()]);
      await csvText();

      expect(download).toMatch(/^expenses-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(href).toBe('blob:stub');
    });

    it('does nothing when there is nothing on screen', () => {
      load([]);

      component.onExportCsv();

      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('exports money in, with what each repayment pays back', async () => {
      load([], {}, [], [
        income({ id: 'i1', description: 'October salary' }),
        income({ id: 'i2', description: 'Kalai share', amount: 364, category: null, splitExpenseId: 's1', splitDescription: 'Vegetables' })
      ]);

      const rows = (await csvText('in')).split('\r\n');

      expect(rows[0]).toBe('Date,Amount,Description,Where It Came From,Account,Pays Back');
      expect(rows[1]).toContain('Salary');
      expect(rows[2]).toMatch(/Repayment,HDFC Bank,Vegetables$/);
      expect(download).toMatch(/^money-in-/);
    });

    it('exports both kinds from All, with a column telling them apart', async () => {
      load([expense({ id: 'e1' })], {}, [], [income({ id: 'i1' })]);

      const rows = (await csvText('all')).split('\r\n');

      expect(rows[0]).toBe(
        'Date,Type,Amount,Description,Category,Account,Status,Your Share,Pays Back'
      );
      expect(rows.slice(1).map(row => row.split(',')[1]).sort()).toEqual(['Credit', 'Debit']);
      expect(download).toMatch(/^transactions-/);
    });
  });

  describe('the tabs', () => {
    const expenses = [expense({ id: 'e1', amount: 100 })];
    const incomes = [
      income({ id: 'i1', amount: 50000 }),
      income({ id: 'i2', amount: 364, category: null, splitExpenseId: 's1', splitDescription: 'Vegetables' })
    ];

    it('shows both kinds on All, and one kind on each of the others', () => {
      load(expenses, {}, [], incomes);

      expect(component.tab).toBe('all');
      expect(component.rows.length).toBe(3);

      component.onTab('out');
      expect(component.rows.map(row => row.kind)).toEqual(['out']);

      component.onTab('in');
      expect(component.rows.map(row => row.kind)).toEqual(['in', 'in']);
    });

    /*
     * Someone handing back their share of a split is not income: counting it
     * would say you earned money you had only fronted.
     */
    it('keeps repayments out of money in, and counts them as paid back', () => {
      load(expenses, {}, [], incomes);

      expect(component.moneyIn).toBe(50000);
      expect(component.paidBack).toBe(364);
      expect(component.total).toBe(100);
    });

    it('files a repayment under Repayment, so it can be filtered on its own', () => {
      load(expenses, {}, [], incomes);
      component.onTab('in');

      expect(component.usedCategories).toEqual(['Repayment', 'Salary']);
    });

    it('a repayment\'s details link to the split it pays back', () => {
      const split: SplitSummary = {
        id: 's1', description: 'Vegetables', date: '2026-10-20', status: 'done',
        amount: 1455, members: 4, share: 364, personal: 363, owed: 1092,
        received: 364, remaining: 728,
        repayments: [{ id: 'i2', amount: 364, description: 'Kalai share', date: '2026-10-20', account: 'HDFC Bank' }]
      };

      const vegetables = expense({ id: 's1', description: 'Vegetables', amount: 1455, splitMembers: 4, personalShare: 363 });
      const fixture = load([...expenses, vegetables], {}, [split], incomes);
      component.onTab('in');
      fixture.detectChanges();

      const repaymentRow = [...fixture.nativeElement.querySelectorAll('.table-row')]
        .find((row: HTMLElement) => row.textContent?.includes('Repayment for')) as HTMLElement;

      repaymentRow.click();
      fixture.detectChanges();

      const link = fixture.nativeElement.querySelector('.split-link') as HTMLButtonElement;
      expect(link.textContent).toContain('Vegetables');
      expect(link.textContent).toContain('₹364 of ₹1,092 back');

      // One click on, to the split expense itself.
      link.click();
      fixture.detectChanges();
      http.expectOne('/api/expenses/s1/attachments').flush([]);
      expect(component.openRow?.key).toBe('out:s1');
    });
  });

  it('opens on the tab the address asks for', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ExpenseListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ tab: 'in' }) } } }
      ]
    });
    http = TestBed.inject(HttpTestingController);

    load([expense()], {}, [], [income()]);

    expect(component.tab).toBe('in');
    expect(component.rows.map(row => row.kind)).toEqual(['in']);
  });
});
