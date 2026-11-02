import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { ExpenseListComponent } from './expense-list.component';
import { DEFAULT_SETTINGS, Expense, Settings } from '../shared/models';
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
  function load(expenses: Expense[], settings: Partial<Settings> = {}) {
    const fixture = TestBed.createComponent(ExpenseListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne('/api/expenses').flush(expenses);
    http.expectOne('/api/settings').flush({ ...DEFAULT_SETTINGS, ...settings });

    fixture.detectChanges();
  }

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

    async function csvText(): Promise<string> {
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
        'Date,Amount,Description,Category,Source Type,Account,Status,Remarks'
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

      expect(header).toBe('Date,Amount,Description,Category,Status,Remarks');
      expect(header).not.toContain('Account');
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
  });
});
