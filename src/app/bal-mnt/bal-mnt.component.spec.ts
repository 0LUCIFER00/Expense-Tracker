import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BalMntComponent } from './bal-mnt.component';
import { TransferFormComponent } from './transfer-form/transfer-form.component';
import { BalanceAccount, DEFAULT_SETTINGS, Settings } from '../shared/models';
import { SettingsService } from '../shared/settings.service';
import { today } from '../shared/date-utils';

const BANK: BalanceAccount = { id: 'b1', type: 'Bank Account', category: 'HDFC Bank', balance: 5000, saved: true, hidden: false };
const WALLET: BalanceAccount = { id: 'w1', type: 'Wallet', category: 'Paytm', balance: 125.5, saved: true, hidden: false };
const CASH: BalanceAccount = { id: 'c1', type: 'Hand Cash', category: 'Personal', balance: 0, saved: true, hidden: false };

describe('BalMntComponent (Cash & Accounts)', () => {
  let fixture: ComponentFixture<BalMntComponent>;
  let page: BalMntComponent;
  let http: HttpTestingController;

  function open(accounts: BalanceAccount[] = [BANK, WALLET, CASH], settings: Partial<Settings> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BalMntComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    // The page reads permissions from the settings already loaded by the guard.
    TestBed.inject(SettingsService).load().subscribe();
    http.expectOne('/api/settings').flush({ ...DEFAULT_SETTINGS, ...settings });

    fixture = TestBed.createComponent(BalMntComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne('/api/balances').flush(accounts);
    fixture.detectChanges();
    if (accounts.length) {
      http.expectOne('/api/transfers').flush([]);
      fixture.detectChanges();
    }
  }

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;

  it('puts the account cards first, then Transfer money, then the history', () => {
    open();

    const order = Array.from(el().querySelectorAll('app-transfer-form, .accounts, app-transfer-history')).map(n => n.tagName.toLowerCase() === 'section' ? 'accounts' : n.tagName.toLowerCase());
    expect(order).toEqual(['accounts', 'app-transfer-form', 'app-transfer-history']);
    expect(el().querySelectorAll('.acct[data-kind]').length).toBe(3);
  });

  it('has no Edit anywhere; each card has a small X to delete', () => {
    open();

    expect(el().textContent).not.toMatch(/\bEdit\b/);
    expect(el().querySelectorAll('.acct .x').length).toBe(3);
    expect(el().querySelector('.acct .x')!.getAttribute('aria-label')).toBe('Delete HDFC Bank');
  });

  it('asks the server first, and explains why an account with money or history cannot be deleted', () => {
    open();
    (el().querySelector('.acct .x') as HTMLButtonElement).click();
    fixture.detectChanges();

    http.expectOne('/api/balances/b1/usage').flush({
      name: 'HDFC Bank', balance: 5000, expenses: 3, incomes: 0, transfers: 1, schedules: 0, deletable: false,
      reasons: ['It still holds ₹5,000. Transfer it to another account first.', 'It has history (3 expenses, 1 transfer).']
    });
    fixture.detectChanges();

    const dialog = el().querySelector('.et-popup')!;
    expect(dialog.textContent).toContain("can't be deleted");
    expect(dialog.querySelectorAll('.reasons li').length).toBe(2);
    expect(dialog.querySelector('.et-btn-danger')).toBeNull();
    http.expectNone('/api/balances/b1');
  });

  it('deletes an empty account with no history after a confirmation', () => {
    open();
    page.askRemove(CASH);
    http.expectOne('/api/balances/c1/usage').flush({
      name: 'Personal', balance: 0, expenses: 0, incomes: 0, transfers: 0, schedules: 0, deletable: true, reasons: []
    });
    fixture.detectChanges();

    (el().querySelector('.et-popup .et-btn-danger') as HTMLButtonElement).click();
    const req = http.expectOne('/api/balances/c1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    fixture.detectChanges();

    expect(page.accounts.map(a => a.id)).toEqual(['b1', 'w1']);
  });

  it('adds an account with an opening balance of zero or more', () => {
    open();
    page.startAdding();
    page.newType = 'Wallet';
    page.newCategory = 'PhonePe';
    page.newBalance = 0;
    page.saveNew();

    const req = http.expectOne('/api/balances');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ type: 'Wallet', category: 'PhonePe', balance: 0 });
    req.flush({ id: 'p1', type: 'Wallet', category: 'PhonePe', balance: 0, saved: true, hidden: false });
    expect(page.accounts.length).toBe(4);
  });

  it('shows the new balances straight after a transfer and reloads the history', () => {
    open();
    page.onTransferred({
      transfer: { id: 't1', fromAccountId: 'b1', toAccountId: 'w1', fromType: '', fromName: '', toType: '', toName: '', amount: 1500, date: today(), description: null, createdAt: '' },
      fromBalance: 3500, toBalance: 1625.5, duplicate: false
    });
    fixture.detectChanges();
    http.expectOne('/api/transfers').flush([]);

    expect(page.accounts.find(a => a.id === 'b1')!.balance).toBe(3500);
    expect(page.accounts.find(a => a.id === 'w1')!.balance).toBe(1625.5);
  });

  it('view-only sign-in: no transfer form, no X, no adding', () => {
    open([BANK, WALLET], { expenseUserAccess: false });

    expect(el().querySelector('app-transfer-form')).toBeNull();
    expect(el().querySelector('.acct .x')).toBeNull();
    expect(el().querySelector('.add-tile')).toBeNull();
    expect(el().textContent).toContain('view-only');
  });
});

describe('TransferFormComponent', () => {
  let fixture: ComponentFixture<TransferFormComponent>;
  let form: TransferFormComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TransferFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TransferFormComponent);
    form = fixture.componentInstance;
    form.accounts = [BANK, WALLET, CASH];
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('never offers the source as the destination', () => {
    expect(form.destinations.map(a => a.id)).toEqual(['w1', 'c1']);
    form.fromId = 'w1';
    form.onFromChange();
    expect(form.toId).not.toBe('w1');
  });

  it('refuses an amount the source does not hold, a bad amount and a future date before asking the server', () => {
    form.fromId = 'w1';
    form.toId = 'b1';
    form.amount = 125.51;
    form.onSubmit();
    expect(form.error).toContain('Not enough in Paytm');

    form.amount = 1.234;
    form.onSubmit();
    expect(form.error).toContain('two decimal places');

    form.amount = 10;
    form.date = '2999-01-01';
    form.onSubmit();
    expect(form.error).toContain('future');

    http.expectNone('/api/transfers');
  });

  it('sends the transfer with a request id, and a new id after success', () => {
    form.amount = 1500;
    form.description = ' Top up ';
    form.onSubmit();

    const req = http.expectOne('/api/transfers');
    const body = req.request.body;
    expect(body).toEqual(jasmine.objectContaining({ fromAccountId: 'b1', toAccountId: 'w1', amount: 1500, description: 'Top up', date: today() }));
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);

    let emitted = false;
    form.transferred.subscribe(() => (emitted = true));
    req.flush({ transfer: { fromAccountId: 'b1', toAccountId: 'w1' }, fromBalance: 3500, toBalance: 1625.5, duplicate: false });

    expect(emitted).toBeTrue();
    expect(form.success).toContain('Moved ₹1,500 from HDFC Bank to Paytm');

    form.amount = 10;
    form.onSubmit();
    expect(http.expectOne('/api/transfers').request.body.requestId).not.toBe(body.requestId);
  });

  it('keeps the same request id when the server could not be reached, so a retry cannot move money twice', () => {
    form.amount = 100;
    form.onSubmit();
    const first = http.expectOne('/api/transfers');
    const id = first.request.body.requestId;
    first.flush({ error: 'down' }, { status: 503, statusText: 'Unavailable' });

    form.onSubmit();
    expect(http.expectOne('/api/transfers').request.body.requestId).toBe(id);
  });

  it('shows the server refusal as an error', () => {
    form.amount = 100;
    form.onSubmit();
    http.expectOne('/api/transfers').flush({ error: 'Not enough in HDFC Bank: it holds ₹50.' }, { status: 409, statusText: 'Conflict' });
    expect(form.error).toBe('Not enough in HDFC Bank: it holds ₹50.');
  });

  it('locks the date to today without "Change transaction dates"', async () => {
    form.canBackdate = false;
    fixture.detectChanges();
    // ngModel applies the disabled state a tick later.
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('#t-date') as HTMLInputElement).disabled).toBeTrue();
  });
});
