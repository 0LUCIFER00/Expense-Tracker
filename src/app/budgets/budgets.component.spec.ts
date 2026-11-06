import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BudgetsComponent } from './budgets.component';
import { BudgetMonth, PreviousBudget } from '../shared/models';
import { currentMonthKey, shiftMonthKey } from '../shared/budget.service';

const THIS_MONTH = currentMonthKey();

function view(overrides: Partial<BudgetMonth> = {}): BudgetMonth {
  return {
    month: THIS_MONTH,
    exists: true,
    overall: 30000,
    fromCategories: false,
    total: 30000,
    spent: 18500,
    remaining: 11500,
    percent: 61.67,
    status: 'on-track',
    allocated: 12000,
    overCount: 1,
    categories: [
      { category: 'Travel', budget: 3000, spent: 3500, remaining: -500, percent: 116.67, status: 'over' },
      { category: 'Food & Drink', budget: 5000, spent: 3200, remaining: 1800, percent: 64, status: 'on-track' }
    ],
    unbudgeted: [{ category: 'Health', spent: 600 }],
    alerts: [{ scope: 'Travel', threshold: 101, spent: 3500, at: '2026-11-03T10:00:00Z' }],
    canManage: true,
    ...overrides
  };
}

const EMPTY: Partial<BudgetMonth> = {
  exists: false, overall: null, total: null, remaining: null, percent: null, status: null,
  allocated: 0, overCount: 0, categories: [], unbudgeted: [], alerts: []
};

describe('BudgetsComponent', () => {
  let fixture: ComponentFixture<BudgetsComponent>;
  let component: BudgetsComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BudgetsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => http.verify());

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Answers what the page asks for when it opens a month. */
  function open(
    month = THIS_MONTH,
    body: BudgetMonth | 'fails' = view(),
    previous: PreviousBudget | null = null
  ) {
    const request = http.expectOne(`/api/budgets/${month}`);

    const previousRequest = http.expectOne(`/api/budgets/${month}/previous`);

    if (body === 'fails') {
      // The page gives up on the pair, which cancels the copy lookup.
      request.flush({ error: 'The server is down.' }, { status: 503, statusText: 'Unavailable' });
      expect(previousRequest.cancelled).toBeTrue();
      fixture.detectChanges();
      return;
    }

    request.flush(body);
    previousRequest.flush(previous);
    fixture.detectChanges();

    // The history section loads once the month is in.
    http.match(req => req.url.startsWith('/api/budgets/history')).forEach(req =>
      req.flush({ months: [], comparison: null, totalOverspend: 0, oftenOver: [] })
    );
    fixture.detectChanges();
  }

  function start() {
    fixture.detectChanges();
    http.expectOne('/api/budgets/categories').flush(['Food & Drink', 'Travel', 'Other', 'Uncategorised']);
  }

  it('shows a loading card until the month arrives', () => {
    start();

    expect(host().querySelector('.skeleton')).not.toBeNull();
    open();
    expect(host().querySelector('.skeleton')).toBeNull();
  });

  it('shows the month: spent of budget, per cent, what is left, categories over', () => {
    start();
    open();

    const overview = host().querySelector('.overview') as HTMLElement;

    expect(overview.textContent).toContain('₹18,500');
    expect(overview.textContent).toContain('of ₹30,000');
    expect(overview.textContent).toContain('61.67% used');
    expect(overview.textContent).toContain('₹11,500 left');
    expect(overview.textContent).toContain('1 category over');
  });

  it('lists each category with its status in words, and what had no budget', () => {
    start();
    open();

    const rows = host().querySelectorAll('.line:not(.line-head)');

    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Travel');
    expect(rows[0].textContent).toContain('−₹500');
    expect(rows[0].textContent).toContain('Over');
    expect(rows[1].textContent).toContain('On track');
    expect(host().querySelector('.unbudgeted')?.textContent).toContain('Health ₹600');
  });

  it('lists this month\'s alerts', () => {
    start();
    open();

    expect(host().querySelector('.alerts')?.textContent).toContain('Travel over budget');
  });

  it('invites a budget for an empty month, with copy when an earlier one exists', () => {
    start();
    open(THIS_MONTH, view({ ...EMPTY, spent: 250 }), { month: shiftMonthKey(THIS_MONTH, -1), total: 30000, categories: [] });

    expect(host().textContent).toContain('No budget for');
    expect(host().textContent).toContain('Create budget');
    expect(host().textContent).toContain('Copy from');
  });

  it('is view only for a sign-in without Manage budgets', () => {
    start();
    open(THIS_MONTH, view({ canManage: false }));

    expect(host().querySelector('.view-only')).not.toBeNull();
    expect(host().textContent).not.toContain('Edit budget');
  });

  it('says what went wrong, and tries again', () => {
    start();
    open(THIS_MONTH, 'fails');

    expect(host().querySelector('.error-text')?.textContent).toContain('The server is down');

    (host().querySelector('.error-text + button') as HTMLButtonElement).click();
    open();

    expect(host().querySelector('.overview')).not.toBeNull();
  });

  it('opens another month', async () => {
    start();
    open();

    component.onMonth(-1);
    await fixture.whenStable();

    open(shiftMonthKey(THIS_MONTH, -1), view({ ...EMPTY, month: shiftMonthKey(THIS_MONTH, -1) }));

    expect(component.monthKey).toBe(shiftMonthKey(THIS_MONTH, -1));
    expect(host().textContent).toContain('This month');
  });

  it('saves an edited budget and shows the result', () => {
    start();
    open();

    component.onEdit();
    fixture.detectChanges();
    expect(host().querySelector('app-budget-editor')).not.toBeNull();

    component.onSave({ total: 35000, categories: [{ category: 'Travel', amount: 4000 }] });

    const put = http.expectOne(`/api/budgets/${THIS_MONTH}`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ total: 35000, categories: [{ category: 'Travel', amount: 4000 }] });
    put.flush(view({ total: 35000, overall: 35000 }));
    fixture.detectChanges();

    expect(component.editing).toBeFalse();
    expect(host().querySelector('.overview')?.textContent).toContain('₹35,000');
  });

  it('asks before saving a copied budget', () => {
    start();
    const previousMonth = shiftMonthKey(THIS_MONTH, -1);
    open(THIS_MONTH, view(EMPTY), { month: previousMonth, total: 30000, categories: [{ category: 'Travel', amount: 3000 }] });

    component.onCopy();
    expect(component.copiedFrom).toBe(previousMonth);
    expect(component.draft.total).toBe(30000);

    component.onSave(component.draft);
    fixture.detectChanges();

    http.expectNone(`/api/budgets/${THIS_MONTH}`);
    expect(host().querySelector('.et-popup')?.textContent).toContain('Nothing that was spent is copied');

    component.onConfirmPending();
    http.expectOne(req => req.method === 'PUT' && req.url === `/api/budgets/${THIS_MONTH}`).flush(view());
  });

  it('asks before removing the month\'s budget', () => {
    start();
    open();

    component.onAskDelete();
    fixture.detectChanges();
    http.expectNone(req => req.method === 'DELETE');

    const dialog = host().querySelector('.et-popup')?.textContent?.replace(/\s+/g, ' ');
    expect(dialog).toContain('expenses are not touched');

    component.onConfirmPending();
    const del = http.expectOne(`/api/budgets/${THIS_MONTH}`);
    expect(del.request.method).toBe('DELETE');
    del.flush(view(EMPTY));
  });
});
