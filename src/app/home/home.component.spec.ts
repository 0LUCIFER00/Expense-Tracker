import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { HomeComponent } from './home.component';
import { BalanceAccount, DEFAULT_SETTINGS, Expense, Settings } from '../shared/models';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    amount: 100,
    description: 'Coffee',
    date: '2026-10-20',
    category: 'Food & Drink',
    sourceId: null,
    sourceType: null,
    sourceCategory: null,
    expenseAccess: false,
    updatePermission: true,
    balanceUpdated: false,
    status: 'Done',
    remarks: null,
    isPendingApproval: false,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides
  };
}

function account(overrides: Partial<BalanceAccount> = {}): BalanceAccount {
  return {
    id: 'b1',
    type: 'Bank Account',
    category: 'HDFC Bank',
    balance: 1000,
    saved: true,
    hidden: false,
    ...overrides
  };
}

/** YYYY-MM-DD for a month offset from today, so the specs never go stale. */
function dateInMonth(monthsAgo: number, day = 15): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day);

  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${String(day).padStart(2, '0')}`;
}

describe('HomeComponent', () => {
  let component: HomeComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function load(
    expenses: Expense[],
    accounts: BalanceAccount[] = [],
    settings: Partial<Settings> = {}
  ) {
    const fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne('/api/expenses').flush(expenses);
    http.expectOne('/api/balances').flush(accounts);
    http.expectOne('/api/settings').flush({ ...DEFAULT_SETTINGS, ...settings });

    fixture.detectChanges();
  }

  describe('the month comparison', () => {
    it('separates this month from last', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 300 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(component.currentMonthSpent).toBe(300);
      expect(component.lastMonthSpent).toBe(200);
    });

    it('reports the change as a percentage of last month', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 300 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(component.monthChange).toBe(50);
    });

    it('reports a fall as a negative percentage', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 50 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(component.monthChange).toBe(-75);
    });

    // Dividing by a zero previous month would give Infinity.
    it('has no percentage when last month was empty', () => {
      load([expense({ date: dateInMonth(0), amount: 300 })]);

      expect(component.monthChange).toBeNull();
    });
  });

  describe('the category breakdown', () => {
    it('covers this month only, largest first', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 100, category: 'Travel' }),
        expense({ id: 'e2', date: dateInMonth(0), amount: 250, category: 'Groceries' }),
        expense({ id: 'e3', date: dateInMonth(1), amount: 900, category: 'Shopping' })
      ]);

      expect(component.categoryBars.map(bar => bar.category)).toEqual([
        'Groceries',
        'Travel'
      ]);
    });

    it('sizes the bars against the biggest category, not the total', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 200, category: 'Travel' }),
        expense({ id: 'e2', date: dateInMonth(0), amount: 100, category: 'Groceries' })
      ]);

      expect(component.categoryBars.map(bar => bar.share)).toEqual([100, 50]);
    });

    it('is empty when this month has nothing in it', () => {
      load([expense({ date: dateInMonth(1), amount: 500 })]);

      expect(component.categoryBars).toEqual([]);
    });
  });

  describe('the rest of the summary', () => {
    it('counts pending entries separately from the total', () => {
      load([
        expense({ id: 'e1', amount: 100 }),
        expense({
          id: 'e2',
          amount: 50,
          status: 'Pending / Waiting Admin',
          isPendingApproval: true
        })
      ]);

      expect(component.totalExpenses).toBe(2);
      expect(component.totalSpent).toBe(100);
      expect(component.pendingCount).toBe(1);
    });

    it('shows five entries, most recently spent first', () => {
      load(
        Array.from({ length: 7 }, (_, i) =>
          expense({ id: `e${i}`, date: `2026-10-${String(i + 10)}` })
        )
      );

      expect(component.recent.map(e => e.id)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2']);
    });

    // Two entries on the same day fall back to the order they were added.
    it('breaks a date tie with the entry order', () => {
      load([
        expense({ id: 'older', date: '2026-10-20', createdAt: '2026-10-20T08:00:00.000Z' }),
        expense({ id: 'newer', date: '2026-10-20', createdAt: '2026-10-20T19:00:00.000Z' })
      ]);

      expect(component.recent.map(e => e.id)).toEqual(['newer', 'older']);
    });

    it('puts a recent spend above one entered later but dated earlier', () => {
      load([
        expense({ id: 'backdated', date: '2026-09-01', createdAt: '2026-10-25T10:00:00.000Z' }),
        expense({ id: 'recent', date: '2026-10-20', createdAt: '2026-10-20T10:00:00.000Z' })
      ]);

      expect(component.recent.map(e => e.id)).toEqual(['recent', 'backdated']);
    });

    it('totals only the saved accounts', () => {
      load(
        [],
        [
          account({ id: 'b1', balance: 1000 }),
          account({ id: 'b2', balance: 500 }),
          account({ id: 'b3', balance: 9999, saved: false })
        ]
      );

      expect(component.accounts.length).toBe(2);
      expect(component.accountsTotal).toBe(1500);
    });

    it('keeps the accounts panel shut when balances are hidden', () => {
      load([], [account()], { balanceUserAccess: false });

      expect(component.canSeeBalances).toBeFalse();
    });
  });
});
