import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LoansComponent } from './loans.component';
import { LoanEditorComponent } from './loan-editor/loan-editor.component';
import { RepaymentFormComponent } from './repayment-form/repayment-form.component';
import { BalanceAccount, Loan, LoanRepayment, LoansOverview } from '../shared/models';

const TODAY = '2026-11-10';
const ACCOUNTS: BalanceAccount[] = [
  { id: 'b1', type: 'Bank Account', category: 'HDFC Bank', balance: 8000, saved: true, hidden: false },
  { id: 'c1', type: 'Hand Cash', category: 'Cash', balance: 500, saved: true, hidden: false },
  { id: 'd1', type: 'Wallet', category: 'Draft', balance: 0, saved: false, hidden: false }
];

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'l1', direction: 'lent', personName: 'Asha Rao', contact: '98450 00000', principal: 2000,
    date: '2026-10-01', dueDate: '2026-12-01', accountId: 'b1', accountType: 'Bank Account', accountName: 'HDFC Bank',
    interest: { type: 'none', rate: null, period: null, label: 'No interest' }, notes: null, status: 'partial',
    cancelledAt: null, cancelReason: null, principalRepaid: 500, interestAccrued: 0, interestPaid: 0, totalRepaid: 500,
    principalOutstanding: 1500, interestOutstanding: 0, outstanding: 1500, outstandingAtDue: null,
    repaymentCount: 1, lastPaidOn: '2026-10-15', termsEditable: false, createdAt: 't',
    ...overrides
  };
}

function repayment(overrides: Partial<LoanRepayment> = {}): LoanRepayment {
  return {
    id: 'r1', loanId: 'l1', direction: 'lent', personName: 'Asha Rao', amount: 500, principal: 500, interest: 0,
    date: '2026-10-15', accountId: 'c1', accountType: 'Hand Cash', accountName: 'Cash', note: 'first part',
    reversed: false, reversedAt: null, reversedReason: null, createdAt: 't',
    ...overrides
  };
}

function overview(overrides: Partial<LoansOverview> = {}): LoansOverview {
  return {
    today: TODAY,
    canManage: true,
    canBackdate: true,
    loans: [
      loan(),
      loan({ id: 'l2', personName: 'Bala', status: 'overdue', dueDate: '2026-11-01', repaymentCount: 0, lastPaidOn: null,
        principalRepaid: 0, totalRepaid: 0, outstanding: 10240, principalOutstanding: 10000, interestOutstanding: 240, principal: 10000,
        interest: { type: 'simple', rate: 12, period: 'year', label: '12% a year, simple' }, termsEditable: true }),
      loan({ id: 'l3', direction: 'borrowed', personName: 'Ravi', accountId: 'c1', accountName: 'Cash', status: 'active',
        repaymentCount: 0, lastPaidOn: null, principalRepaid: 0, totalRepaid: 0, outstanding: 3000, principal: 3000 })
    ],
    repayments: [repayment()],
    summary: {
      totalLent: 12000, totalBorrowed: 3000, toReceive: 11740, toPay: 3000, interestReceived: 0, interestPaid: 0,
      interestExpected: 240, interestOwed: 0, overdue: 1, open: 3
    },
    ...overrides
  };
}

describe('LoansComponent', () => {
  let fixture: ComponentFixture<LoansComponent>;
  let component: LoansComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoansComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoansComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => http.verify());

  const host = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => Array.from(host().querySelectorAll(selector)).map(e => e.textContent!.replace(/\s+/g, ' ').trim());

  function open(body: LoansOverview = overview()) {
    fixture.detectChanges();
    http.expectOne('/api/loans').flush(body);
    http.expectOne('/api/balances').flush(ACCOUNTS);
    fixture.detectChanges();
  }

  /** Every save reloads the records and the accounts. */
  function reload(body: LoansOverview = overview()) {
    http.expectOne('/api/loans').flush(body);
    http.expectOne('/api/balances').flush(ACCOUNTS);
    fixture.detectChanges();
  }

  it('shows the totals, with interest counted apart', () => {
    open();
    const stats = text('.summary .stat');

    expect(stats.length).toBe(6);
    expect(stats[0]).toContain('Money lent');
    expect(stats[2]).toContain('To receive');
    expect(stats[2]).toContain('interest');
    expect(stats[4]).toContain('counted as income');
    expect(stats[5]).toContain('counted as expenses');
  });

  it('lists money given first, overdue on top, and opens the first record', () => {
    open();

    expect(text('.item .name')).toEqual(['Bala', 'Asha Rao']);
    expect(text('.item .chip')).toEqual(['Overdue', 'Partially paid']);
    expect(component.selectedId).toBe('l2');
    expect(host().querySelector('.detail h2')!.textContent).toContain('Bala');
  });

  it('has three tabs: money given, money received and the repayment history', () => {
    open();

    expect(text('.tab')).toEqual(['Money given 2', 'Money received 1', 'Repayment history 1']);

    component.setTab('borrowed');
    fixture.detectChanges();
    expect(text('.item .name')).toEqual(['Ravi']);
    expect(text('.item .meta')[1]).toBe('you owe');

    component.setTab('history');
    fixture.detectChanges();
    const row = text('.h-item')[0];
    expect(row).toContain('Asha Rao');
    expect(row).toContain('Cash');
    expect(row).toContain('first part');
  });

  it('filters by person, status, account and date', () => {
    open();

    component.filters.person = 'asha';
    expect(component.shown.map(l => l.id)).toEqual(['l1']);

    component.clearFilters();
    component.filters.status = 'overdue';
    expect(component.shown.map(l => l.id)).toEqual(['l2']);

    component.clearFilters();
    component.filters.account = 'c1';
    expect(component.shown.map(l => l.id)).withContext('repaid into Cash').toEqual(['l1']);

    component.clearFilters();
    component.filters.from = '2026-10-02';
    expect(component.shown.length).toBe(0);
    expect(component.filtered).toBeTrue();
  });

  it('shows the record: original account with a link to it, interest and what is owed', () => {
    open();
    component.select(component.view!.loans[0]);
    fixture.detectChanges();

    const detail = host().querySelector('.detail')!.textContent!.replace(/\s+/g, ' ');
    expect(detail).toContain('Given from');
    expect(detail).toContain('HDFC Bank');
    expect(detail).toContain('Repayments');
    expect(host().querySelector('.detail a[href="/money?account=b1"]')).not.toBeNull();
  });

  it('records money given, with a request id, and shows the saved accounts only', () => {
    open();
    component.onNew('lent');
    fixture.detectChanges();

    const editor = fixture.debugElement.query(e => e.componentInstance instanceof LoanEditorComponent).componentInstance as LoanEditorComponent;
    expect(editor.accounts.map(a => a.category)).toEqual(['HDFC Bank', 'Cash']);

    Object.assign(editor, { personName: 'Chitra', amount: 1200, accountId: 'b1' });
    editor.onSubmit();

    const req = http.expectOne('/api/loans');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(jasmine.objectContaining({
      direction: 'lent', personName: 'Chitra', amount: 1200, accountId: 'b1', date: TODAY, interest: { type: 'none' }
    }));
    expect(req.request.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ loan: loan({ id: 'l9', personName: 'Chitra' }), balanceAfter: 6800, duplicate: false });
    reload();

    expect(component.editorOpen).toBeFalse();
  });

  it('refuses, before sending, to lend more than the account holds', () => {
    open();
    component.onNew('lent');
    fixture.detectChanges();

    const editor = fixture.debugElement.query(e => e.componentInstance instanceof LoanEditorComponent).componentInstance as LoanEditorComponent;
    Object.assign(editor, { personName: 'Chitra', amount: 600, accountId: 'c1' });
    editor.onSubmit();

    expect(editor.error).toContain('Cash holds ₹500');
    http.expectNone('/api/loans');
  });

  it('records a repayment: asks what is owed, shows interest first, then sends it', () => {
    open();
    component.onOpenRepay(component.view!.loans[1]);
    http.expectOne(`/api/loans/l2/quote?date=${TODAY}`).flush({ date: TODAY, principalDue: 10000, interestDue: 240, totalDue: 10240, lastPaidOn: null });
    fixture.detectChanges();

    const form = fixture.debugElement.query(e => e.componentInstance instanceof RepaymentFormComponent).componentInstance as RepaymentFormComponent;
    form.amount = 1000;
    expect(form.split).toEqual({ interest: 240, principal: 760 });

    form.accountId = 'c1';
    form.onSubmit();
    const req = http.expectOne('/api/loans/l2/repayments');
    expect(req.request.body).toEqual(jasmine.objectContaining({ amount: 1000, accountId: 'c1', date: TODAY }));
    req.flush({ repayment: repayment({ id: 'r9', loanId: 'l2', amount: 1000, interest: 240, principal: 760 }), loan: null, duplicate: false });
    reload();

    expect(component.repayFor).toBeNull();
  });

  it('will not record a repayment over what is owed', () => {
    open();
    component.onOpenRepay(component.view!.loans[1]);
    http.expectOne(`/api/loans/l2/quote?date=${TODAY}`).flush({ date: TODAY, principalDue: 10000, interestDue: 240, totalDue: 10240, lastPaidOn: null });
    fixture.detectChanges();

    const form = fixture.debugElement.query(e => e.componentInstance instanceof RepaymentFormComponent).componentInstance as RepaymentFormComponent;
    form.amount = 10240.01;
    form.onSubmit();

    expect(form.error).toContain('Only ₹10,240');
    http.expectNone('/api/loans/l2/repayments');
  });

  it('offers to reverse only the latest repayment, and asks first', () => {
    open(overview({ repayments: [repayment({ id: 'r2', date: '2026-10-20' }), repayment()] }));
    component.select(component.view!.loans[1]);
    component.select(component.view!.loans.find(l => l.id === 'l1')!);
    fixture.detectChanges();

    const reverse = Array.from(host().querySelectorAll<HTMLButtonElement>('.h-row .link')).filter(b => b.textContent!.includes('Reverse'));
    expect(reverse.length).toBe(1);

    reverse[0].click();
    fixture.detectChanges();
    expect(host().querySelector('#rev-title')).not.toBeNull();

    component.onConfirmReverse();
    http.expectOne('/api/loans/l1/repayments/r2/reverse').flush({ repayment: repayment({ id: 'r2', reversed: true }), loan: null });
    reload();
  });

  it('cancels only after confirming, and sends the confirmation', () => {
    open();
    component.onAskCancel(component.view!.loans[0]);
    fixture.detectChanges();

    expect(host().querySelector('#cancel-title')!.textContent).toContain('Asha Rao');
    expect(host().querySelector('.loans-confirm .et-popup-body')!.textContent).toContain('Nothing is deleted');

    component.cancelReason = 'Typed twice';
    component.onConfirmCancel();
    const req = http.expectOne('/api/loans/l1/cancel');
    expect(req.request.body).toEqual({ confirm: true, reason: 'Typed twice' });
    req.flush({ loan: loan({ status: 'cancelled' }), reversedRepayments: 1 });
    reload();
  });

  it('keeps the account fixed when editing, and the terms once repaid', async () => {
    open();
    component.onEdit(component.view!.loans[0]);
    fixture.detectChanges();
    // ngModel applies [disabled] a tick later.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host().querySelector<HTMLSelectElement>('#l-account')!.disabled).toBeTrue();
    expect(host().querySelector<HTMLInputElement>('#l-amount')!.disabled).toBeTrue();
    expect(host().textContent).toContain('fixed once a repayment is recorded');
  });

  it('hides the buttons from a sign-in that may not change balances', () => {
    open(overview({ canManage: false }));

    expect(host().querySelector('.head-actions')).toBeNull();
    expect(host().querySelector('.d-actions')).toBeNull();
  });

  it('says so when there is nothing yet', () => {
    open(overview({ loans: [], repayments: [] }));

    expect(host().querySelector('.empty')!.textContent).toContain('No money given yet');
  });
});
