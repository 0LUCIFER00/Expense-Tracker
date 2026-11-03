import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { HomeComponent } from './home.component';
import { BalanceAccount, DEFAULT_SETTINGS, Expense, Settings } from '../shared/models';
import { DashboardData } from '../shared/dashboard';

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
  let fixture: ComponentFixture<HomeComponent>;
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


  /** The summary the component built, asserted on by every test below. */
  function data(): DashboardData {
    expect(component.data).not.toBeNull();
    return component.data as DashboardData;
  }

  /** Last month is not on the summary; it is the figure the delta came from. */
  function lastMonthSpent(): number {
    const d = data();
    return d.spentMore ? d.spent - d.difference : d.spent + d.difference;
  }

  function load(
    expenses: Expense[],
    accounts: BalanceAccount[] = [],
    settings: Partial<Settings> = {}
  ) {
    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne('/api/expenses').flush(expenses);
    http.expectOne('/api/balances').flush(accounts);
    http.expectOne('/api/settings').flush({ ...DEFAULT_SETTINGS, ...settings });
    http.expectOne('/api/whatsapp/link').flush({
      available: true,
      connected: false,
      number: null,
      businessNumber: '919000000000'
    });

    fixture.detectChanges();
  }

  describe('the month comparison', () => {
    it('separates this month from last', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 300 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(data().spent).toBe(300);
      expect(lastMonthSpent()).toBe(200);
    });

    it('reports how much more was spent, and that it was more', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 300 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(data().difference).toBe(100);
      expect(data().spentMore).toBeTrue();
    });

    // The pill reads "less than October", so the figure itself stays positive.
    it('reports a fall as a positive figure the other way round', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 50 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(data().difference).toBe(150);
      expect(data().spentMore).toBeFalse();
    });

    it('has no difference to show when the two months match', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 200 }),
        expense({ id: 'e2', date: dateInMonth(1), amount: 200 })
      ]);

      expect(data().difference).toBe(0);
    });

    it('averages over the days gone by, not the whole month', () => {
      load([expense({ date: dateInMonth(0), amount: 300 })]);

      expect(data().dailyAverage).toBe(Math.round(300 / new Date().getDate()));
    });

    it('counts this month’s entries only', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0) }),
        expense({ id: 'e2', date: dateInMonth(0) }),
        expense({ id: 'e3', date: dateInMonth(1) })
      ]);

      expect(data().entries).toBe(2);
    });
  });

  describe('the category breakdown', () => {
    it('covers this month only, largest first', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 100, category: 'Travel' }),
        expense({ id: 'e2', date: dateInMonth(0), amount: 250, category: 'Groceries' }),
        expense({ id: 'e3', date: dateInMonth(1), amount: 900, category: 'Shopping' })
      ]);

      expect(data().categories.map(bar => bar.name)).toEqual([
        'Groceries',
        'Travel'
      ]);
    });

    it('sizes the bars against the biggest category, not the total', () => {
      load([
        expense({ id: 'e1', date: dateInMonth(0), amount: 200, category: 'Travel' }),
        expense({ id: 'e2', date: dateInMonth(0), amount: 100, category: 'Groceries' })
      ]);

      expect(data().categories.map(bar => bar.share)).toEqual([100, 50]);
    });

    it('is empty when this month has nothing in it', () => {
      load([expense({ date: dateInMonth(1), amount: 500 })]);

      expect(data().categories).toEqual([]);
    });
  });

  describe('the rest of the summary', () => {
    // Twelve is what the ledger layout's table can show; the other layout
    // draws as many as its card has room for.
    it('caps the list at twelve, most recently spent first', () => {
      load(
        Array.from({ length: 15 }, (_, i) =>
          expense({ id: `e${i}`, date: `2026-10-${String(i + 10).padStart(2, '0')}` })
        )
      );

      const ids = data().recent.map(e => e.id);

      expect(ids.length).toBe(12);
      expect(ids.slice(0, 3)).toEqual(['e14', 'e13', 'e12']);
    });

    // Two entries on the same day fall back to the order they were added.
    it('breaks a date tie with the entry order', () => {
      load([
        expense({ id: 'older', date: '2026-10-20', createdAt: '2026-10-20T08:00:00.000Z' }),
        expense({ id: 'newer', date: '2026-10-20', createdAt: '2026-10-20T19:00:00.000Z' })
      ]);

      expect(data().recent.map(e => e.id)).toEqual(['newer', 'older']);
    });

    it('puts a recent spend above one entered later but dated earlier', () => {
      load([
        expense({ id: 'backdated', date: '2026-09-01', createdAt: '2026-10-25T10:00:00.000Z' }),
        expense({ id: 'recent', date: '2026-10-20', createdAt: '2026-10-20T10:00:00.000Z' })
      ]);

      expect(data().recent.map(e => e.id)).toEqual(['recent', 'backdated']);
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

      expect(data().accounts.length).toBe(2);
      expect(data().accountsTotal).toBe(1500);
    });

    it('orders the accounts by balance and sizes them against the largest', () => {
      load(
        [],
        [
          account({ id: 'b1', category: 'Paytm', balance: 250 }),
          account({ id: 'b2', category: 'HDFC Bank', balance: 1000 })
        ]
      );

      expect(data().accounts.map(row => row.name)).toEqual([
        'HDFC Bank',
        'Paytm'
      ]);
      expect(data().accounts.map(row => row.share)).toEqual([100, 25]);
    });

    // A zero balance would otherwise render as an invisible bar.
    it('leaves an empty account a visible sliver', () => {
      load(
        [],
        [
          account({ id: 'b1', balance: 1000 }),
          account({ id: 'b2', balance: 0 })
        ]
      );

      expect(data().accounts[1].share).toBe(2);
    });

    it('keeps the accounts panel shut when balances are hidden', () => {
      load([], [account()], { balanceUserAccess: false });

      expect(data().canSeeBalances).toBeFalse();
    });
  });

  /*
   * The layout follows the permission rather than a preference. Hiding
   * balances is the admin password's whole purpose, so it cannot be left to
   * a setting someone could forget.
   */
  describe('which layout is drawn', () => {
    function host(): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    }

    it('uses the balances layout when they may be seen', () => {
      load([expense()], [account()]);

      expect(host().querySelector('app-balances-layout')).not.toBeNull();
      expect(host().querySelector('app-spending-layout')).toBeNull();
    });

    it('uses the spending layout when they may not', () => {
      load([expense()], [account()], { balanceUserAccess: false });

      expect(host().querySelector('app-spending-layout')).not.toBeNull();
      expect(host().querySelector('app-balances-layout')).toBeNull();
    });

    it('draws neither until the figures are in', () => {
      const built = TestBed.createComponent(HomeComponent);
      built.detectChanges();

      const el = built.nativeElement as HTMLElement;

      expect(el.querySelector('app-balances-layout')).toBeNull();
      expect(el.querySelector('app-spending-layout')).toBeNull();

      http.expectOne('/api/expenses').flush([]);
      http.expectOne('/api/balances').flush([]);
      http.expectOne('/api/settings').flush(DEFAULT_SETTINGS);
      http.expectOne('/api/whatsapp/link').flush({
        available: false,
        connected: false,
        number: null,
        businessNumber: null
      });
    });
  });
});
