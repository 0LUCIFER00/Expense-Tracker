import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BudgetHistoryComponent } from './budget-history.component';
import { BudgetHistory } from '../../shared/models';

const HISTORY: BudgetHistory = {
  months: [
    { month: '2026-09', total: 30000, spent: 33000, percent: 110, status: 'over', over: 3000, categories: [] },
    { month: '2026-10', total: null, spent: 19700, percent: null, status: null, over: 0, categories: [] },
    { month: '2026-11', total: 30000, spent: 18500, percent: 61.67, status: 'on-track', over: 0, categories: [] }
  ],
  comparison: { month: '2026-11', previousMonth: '2026-10', spent: 18500, previousSpent: 19700, difference: -1200 },
  totalOverspend: 3000,
  oftenOver: [{ category: 'Travel', overMonths: 2, budgetedMonths: 3 }]
};

describe('BudgetHistoryComponent', () => {
  let fixture: ComponentFixture<BudgetHistoryComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BudgetHistoryComponent);
    fixture.componentInstance.monthKey = '2026-11';
    fixture.componentInstance.ngOnChanges();
  });

  afterEach(() => http.verify());

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('shows six months by default, budget against spending', () => {
    http.expectOne('/api/budgets/history?end=2026-11&months=6').flush(HISTORY);
    fixture.detectChanges();

    const months = host().querySelectorAll('.month');

    expect(months.length).toBe(3);
    expect(months[0].textContent).toContain('of ₹30,000');
    expect(months[1].textContent).toContain('no budget');
    expect(host().querySelector('.facts')?.textContent).toContain('₹1,200 less spent');
    expect(host().querySelector('.facts')?.textContent).toContain('Over budget by ₹3,000');
    expect(host().querySelector('.facts')?.textContent).toContain('Travel');
  });

  it('switches to twelve months', () => {
    http.expectOne('/api/budgets/history?end=2026-11&months=6').flush(HISTORY);

    fixture.componentInstance.onSpan(12);

    http.expectOne('/api/budgets/history?end=2026-11&months=12').flush(HISTORY);
    fixture.detectChanges();

    expect(host().querySelector('.span.on')?.textContent).toContain('12');
  });

  it('says when history could not load', () => {
    http.expectOne('/api/budgets/history?end=2026-11&months=6')
      .flush({ error: 'Try later.' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(host().querySelector('.error')?.textContent).toContain('Try later.');
  });
});
