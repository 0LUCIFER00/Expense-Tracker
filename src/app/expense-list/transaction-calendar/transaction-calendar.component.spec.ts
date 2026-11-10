import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TransactionCalendarComponent } from './transaction-calendar.component';
import type { TransactionRow } from '../expense-list.component';
import { Expense, Income } from '../../shared/models';

function spent(date: string, amount: number, description = 'Milk', extra: Partial<Expense> = {}): TransactionRow {
  const expense = {
    id: `${date}-${description}`, amount, description, date, category: 'Groceries', sourceCategory: 'HDFC Bank',
    status: 'Done', isPendingApproval: false, createdAt: `${date}T10:00:00Z`, ...extra
  } as Expense;
  return { key: `out:${expense.id}`, kind: 'out', date, amount, description, category: expense.category ?? 'Uncategorised',
    account: 'HDFC Bank', status: 'Completed', createdAt: expense.createdAt, expense };
}

function came(date: string, amount: number, description = 'Salary', extra: Partial<Income> = {}): TransactionRow {
  const income = { id: `${date}-${description}`, amount, description, date, category: 'Salary',
    targetCategory: 'HDFC Bank', createdAt: `${date}T09:00:00Z`, ...extra } as Income;
  return { key: `in:${income.id}`, kind: 'in', date, amount, description, category: extra.splitExpenseId ? 'Repayment' : 'Salary',
    account: 'HDFC Bank', status: 'Completed', createdAt: income.createdAt, income };
}

const NOVEMBER: TransactionRow[] = [
  spent('2026-11-01', 180, 'Lunch'),
  spent('2026-11-02', 1820, 'Groceries at DMart'),
  spent('2026-11-03', 349, 'Swiggy'),
  came('2026-11-04', 45000),
  spent('2026-11-05', 750, 'Cab'),
  spent('2026-11-06', 60), spent('2026-11-06', 900, 'Shoes'), spent('2026-11-06', 649, 'Netflix'), spent('2026-11-06', 2600, 'Flight'),
  spent('2026-11-07', 60), spent('2026-11-08', 60),
  spent('2026-11-09', 60),
  spent('2026-11-09', 1200, 'Team dinner', { splitMembers: 4, personalShare: 300, splitShare: 300 }),
  came('2026-11-09', 300, 'Kalai share', { splitExpenseId: 'dinner' }),
  spent('2026-11-10', 60), spent('2026-11-10', 2000, 'Electricity bill'),
  spent('2026-10-31', 999, 'October'), spent('2026-12-01', 999, 'December')
];

describe('TransactionCalendarComponent', () => {
  let fixture: ComponentFixture<TransactionCalendarComponent>;
  let component: TransactionCalendarComponent;
  let el: HTMLElement;

  function render(rows = NOVEMBER, month = '2026-11', today = '2026-11-10'): void {
    TestBed.configureTestingModule({ imports: [TransactionCalendarComponent] });
    fixture = TestBed.createComponent(TransactionCalendarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('month', month);
    fixture.componentRef.setInput('today', today);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  const cell = (iso: string) => el.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`)!;
  const summary = () => Array.from(el.querySelectorAll('.cal-summary .v')).map(v => v.textContent!.trim());

  it('sums the month by the list\'s rules: your share, income without repayments, net and count', () => {
    render();

    // Expenses 180+1820+349+750+4209+60+60+60+300+2060 = 9,848; the split counts ₹300, the repayment nothing.
    expect(summary()).toEqual(['+₹45,000', '−₹9,848', '+₹35,152', '16']);
  });

  it('draws whole Monday-first weeks, with the neighbouring months faded and not selectable', () => {
    render();

    expect(el.querySelectorAll('.cell').length).toBe(42);
    expect(cell('2026-10-26').classList).toContain('out-month');
    expect(cell('2026-10-26').disabled).toBeTrue();
    expect(cell('2026-11-01').disabled).toBeFalse();
    expect(Array.from(el.querySelectorAll('.cal-weekdays span')).map(s => s.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('shows each day\'s spending and income, highlights today and marks empty days', () => {
    render();

    expect(cell('2026-11-06').querySelector('.c-out .full')!.textContent).toBe('−₹4,209');
    expect(cell('2026-11-04').querySelector('.c-in .full')!.textContent).toBe('+₹45,000');
    expect(cell('2026-11-09').querySelector('.c-out .full')!.textContent).withContext('dinner at your share').toBe('−₹360');
    expect(cell('2026-11-10').classList).toContain('today');
    expect(cell('2026-11-12').classList).toContain('empty');
    expect(cell('2026-11-12').classList).toContain('future');
    expect(cell('2026-11-12').getAttribute('aria-label')).toContain('nothing recorded');
  });

  it('marks the high-spending day, explaining the rule', () => {
    render();

    const high = Array.from(el.querySelectorAll('.cell.high')).map(c => c.getAttribute('data-iso'));
    expect(high).toEqual(['2026-11-06']);
    expect(cell('2026-11-06').querySelector('.c-high')!.getAttribute('title')).toContain('more than twice your average spending day this month (₹1,094)');
    expect(el.querySelector('.cal-legend')!.textContent).toContain('more than twice your average spending day');
  });

  it('opens on today, and a chosen day lists its entries with type, category and account', () => {
    render();
    expect(el.querySelector('.cal-day h2')!.textContent).toContain('10 November');

    cell('2026-11-09').click();
    fixture.detectChanges();

    const rows = Array.from(el.querySelectorAll('.d-row')).map(r => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows.length).toBe(3);
    expect(rows.some(r => r.includes('Team dinner') && r.includes('split 4, yours ₹300'))).toBeTrue();
    expect(rows.some(r => r.includes('Kalai share') && r.includes('Repayment, not income'))).toBeTrue();
    expect(rows.every(r => r.includes('HDFC Bank'))).toBeTrue();
    expect(el.querySelector('.d-totals')!.textContent).toContain('Repaid ₹300');
  });

  it('hands an entry to the list\'s details drawer instead of showing its own', () => {
    render();
    const opened = spyOn(component.open, 'emit');

    cell('2026-11-04').click();
    fixture.detectChanges();
    (el.querySelector('.d-row') as HTMLButtonElement).click();

    expect(opened).toHaveBeenCalledOnceWith(jasmine.objectContaining({ description: 'Salary' }));
  });

  it('says so when the day chosen has nothing', () => {
    render();

    cell('2026-11-11').click();
    fixture.detectChanges();

    expect(el.querySelector('.d-empty')!.textContent).toContain('Nothing planned on this day');
    expect(el.querySelector('.d-list')).toBeNull();
  });

  it('hides the account where this sign-in may not see it', () => {
    render();
    fixture.componentRef.setInput('canViewSource', false);
    fixture.detectChanges();

    expect(el.querySelector('.d-meta')!.textContent).not.toContain('HDFC Bank');
  });

  it('opens a month without today on no day, and moves with the arrow keys', () => {
    render(NOVEMBER, '2026-12');
    expect(el.querySelector('.cal-day')!.textContent).toContain('Choose a day');
    expect(summary()[3]).toBe('1');

    fixture.componentRef.setInput('month', '2026-11');
    fixture.detectChanges();
    cell('2026-11-10').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(component.selected).toBe('2026-11-09');

    cell('2026-11-09').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(component.selected).toBe('2026-11-02');
  });

  it('says so when nothing in the month matches', () => {
    render([], '2026-11');

    expect(el.textContent).toContain('Nothing in this month matches');
    expect(summary()).toEqual(['+₹0', '−₹0', '+₹0', '0']);
  });

  it('shows a loading state', () => {
    render();
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(el.querySelector('.cal-state')!.textContent).toContain('Loading');
    expect(el.querySelector('.cal-grid')).toBeNull();
  });

  it('carries both a full and a short amount, for laptop and phone widths', () => {
    render();

    expect(cell('2026-11-06').querySelector('.brief')!.textContent).toBe('4.2k');
    expect(cell('2026-11-04').querySelector('.c-in .brief')!.textContent).toBe('+45k');
    expect(cell('2026-11-06').querySelector('.dot.out')).not.toBeNull();
  });
});
