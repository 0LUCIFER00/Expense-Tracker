import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { ExpenseService, UNCATEGORISED } from './expense.service';
import { BalanceService } from './balance.service';
import { Expense } from './models';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    amount: 100,
    description: 'Coffee',
    date: '2026-10-20',
    category: null,
    sourceId: null,
    sourceType: null,
    sourceCategory: null,
    expenseAccess: false,
    updatePermission: true,
    balanceUpdated: false,
    status: 'Done',
    remarks: null,
    isPendingApproval: false,
    createdAt: '2026-10-20T00:00:00.000Z',
    ...overrides
  };
}

describe('ExpenseService', () => {
  let service: ExpenseService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    service = TestBed.inject(ExpenseService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists expenses', () => {
    let received: Expense[] = [];
    service.list().subscribe(result => (received = result));

    http.expectOne('/api/expenses').flush([expense(), expense({ id: 'e2' })]);

    expect(received.length).toBe(2);
  });

  it('posts a new expense with the timezone offset', () => {
    service
      .create({
        amount: 250,
        description: 'Groceries',
        date: '2026-10-30',
        category: 'Groceries',
        sourceId: 'b1',
        updateBalance: true,
        tzOffset: -330
      })
      .subscribe();

    const request = http.expectOne('/api/expenses');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      amount: 250,
      description: 'Groceries',
      date: '2026-10-30',
      category: 'Groceries',
      sourceId: 'b1',
      updateBalance: true,
      tzOffset: -330
    });

    request.flush(expense());
  });

  it('surfaces an insufficient-balance rejection', done => {
    service
      .create({
        amount: 9999,
        description: 'Too much',
        date: '2026-10-30',
        category: null,
        sourceId: 'b1',
        updateBalance: true,
        tzOffset: 0
      })
      .subscribe({
        error: error => {
          expect(error.status).toBe(409);
          expect(error.message).toBe('Insufficient balance.');
          done();
        }
      });

    http.expectOne('/api/expenses').flush(
      { error: 'Insufficient balance.' },
      { status: 409, statusText: 'Conflict' }
    );
  });

  it('approves a pending entry by id', () => {
    service.approve('e9').subscribe();

    const request = http.expectOne('/api/expenses/e9/approve');
    expect(request.request.method).toBe('POST');

    request.flush(expense({ id: 'e9' }));
  });

  it('deletes by id and reports a refund', () => {
    let removed: { refunded: boolean; sourceCategory: string | null } | undefined;
    service.remove('e9').subscribe(result => (removed = result));

    const request = http.expectOne('/api/expenses/e9');
    expect(request.request.method).toBe('DELETE');

    request.flush({ id: 'e9', refunded: true, sourceCategory: 'HDFC Bank' });

    expect(removed?.refunded).toBeTrue();
    expect(removed?.sourceCategory).toBe('HDFC Bank');
  });

  it('reports when nothing was refunded', () => {
    let removed: { refunded: boolean } | undefined;
    service.remove('e9').subscribe(result => (removed = result));

    http.expectOne('/api/expenses/e9').flush({
      id: 'e9',
      refunded: false,
      sourceCategory: null
    });

    expect(removed?.refunded).toBeFalse();
  });

  describe('totalOf', () => {
    it('counts only settled entries', () => {
      const total = service.totalOf([
        expense({ amount: 100 }),
        expense({ amount: 50, status: 'Pending / Waiting Admin' })
      ]);

      expect(total).toBe(100);
    });

    it('coerces string amounts rather than concatenating', () => {
      const total = service.totalOf([
        expense({ amount: '100' as unknown as number }),
        expense({ amount: '50' as unknown as number })
      ]);

      expect(total).toBe(150);
    });

    it('is zero for an empty list', () => {
      expect(service.totalOf([])).toBe(0);
    });

    /*
     * ₹1,455 of vegetables left the account, but split four ways only ₹363 of
     * it was the owner's own spending — the rest they fronted for others.
     */
    it('counts only your share of a split expense', () => {
      const total = service.totalOf([
        expense({ amount: 1455, splitMembers: 4, splitShare: 364, personalShare: 363 }),
        expense({ amount: 100 })
      ]);

      expect(total).toBe(463);
    });

    it('files only your share of a split under its category', () => {
      const totals = service.byCategory([
        expense({ amount: 1455, category: 'Groceries', splitMembers: 4, personalShare: 363 })
      ]);

      expect(totals).toEqual([{ category: 'Groceries', total: 363 }]);
    });
  });

  describe('listCategories', () => {
    it('fetches the list the server allows', () => {
      let received: string[] = [];
      service.listCategories().subscribe(categories => (received = categories));

      http.expectOne('/api/expenses/categories').flush(['Food & Drink', 'Travel']);

      expect(received).toEqual(['Food & Drink', 'Travel']);
    });

    it('asks once, however many callers there are', () => {
      service.listCategories().subscribe();
      http.expectOne('/api/expenses/categories').flush(['Travel']);

      service.listCategories().subscribe();
      http.expectNone('/api/expenses/categories');
    });
  });

  describe('byCategory', () => {
    it('sums settled entries per category, largest first', () => {
      const totals = service.byCategory([
        expense({ category: 'Travel', amount: 300 }),
        expense({ category: 'Food & Drink', amount: 100 }),
        expense({ category: 'Food & Drink', amount: 250 })
      ]);

      expect(totals).toEqual([
        { category: 'Food & Drink', total: 350 },
        { category: 'Travel', total: 300 }
      ]);
    });

    it('groups entries with no category rather than dropping them', () => {
      const totals = service.byCategory([
        expense({ category: null, amount: 40 }),
        expense({ category: null, amount: 60 })
      ]);

      expect(totals).toEqual([{ category: UNCATEGORISED, total: 100 }]);
    });

    it('leaves pending entries out, like totalOf does', () => {
      const totals = service.byCategory([
        expense({ category: 'Travel', amount: 300 }),
        expense({ category: 'Travel', amount: 99, status: 'Pending / Waiting Admin' })
      ]);

      expect(totals).toEqual([{ category: 'Travel', total: 300 }]);
    });

    it('is empty for an empty list', () => {
      expect(service.byCategory([])).toEqual([]);
    });
  });
});

describe('BalanceService', () => {
  let service: BalanceService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    service = TestBed.inject(BalanceService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists accounts', () => {
    service.list().subscribe();
    http.expectOne('/api/balances').flush([]);
  });

  it('creates with POST', () => {
    service.create({ type: 'Wallet', category: 'Paytm', balance: 500 }).subscribe();

    const request = http.expectOne('/api/balances');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.category).toBe('Paytm');

    request.flush({ id: 'b1', type: 'Wallet', category: 'Paytm', balance: 500, saved: true });
  });

  it('updates an existing account with PUT', () => {
    service.update('b1', { type: 'Wallet', category: 'Paytm', balance: 900 }).subscribe();

    const request = http.expectOne('/api/balances/b1');
    expect(request.request.method).toBe('PUT');

    request.flush({ id: 'b1', type: 'Wallet', category: 'Paytm', balance: 900, saved: true });
  });

  it('deletes by id', () => {
    service.remove('b1').subscribe();

    expect(http.expectOne('/api/balances/b1').request.method).toBe('DELETE');
    http.verify();
  });
});
