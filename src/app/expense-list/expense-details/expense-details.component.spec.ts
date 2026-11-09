import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ExpenseDetailsComponent } from './expense-details.component';
import { Expense } from '../../shared/models';

const EXPENSE = {
  id: 'e1', amount: 1455, description: 'Vegetables', date: '2026-11-09', category: 'Groceries',
  sourceId: 'b1', sourceType: 'Bank Account', sourceCategory: 'HDFC Bank', expenseAccess: true,
  updatePermission: true, balanceUpdated: true, status: 'Done', remarks: null, isPendingApproval: false,
  createdAt: '', attachmentCount: 2
} as unknown as Expense;

const ATTACHMENTS = [
  { id: 'a1', expenseId: 'e1', fileName: 'bill.jpg', contentType: 'image/jpeg', size: 120000, createdAt: '' },
  { id: 'a2', expenseId: 'e1', fileName: 'invoice.pdf', contentType: 'application/pdf', size: 300000, createdAt: '' }
];

describe('ExpenseDetailsComponent (Receipts & Invoices)', () => {
  let fixture: ComponentFixture<ExpenseDetailsComponent>;
  let details: ExpenseDetailsComponent;
  let http: HttpTestingController;

  function open(canRemove = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ExpenseDetailsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ExpenseDetailsComponent);
    details = fixture.componentInstance;
    details.expense = EXPENSE;
    details.canRemove = canRemove;
    fixture.detectChanges();
    http.expectOne('/api/expenses/e1/attachments').flush(ATTACHMENTS);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows a thumbnail for an image and a PDF tile, from this site\'s own API', () => {
    open();

    const img = el().querySelector('.tile img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/expenses/e1/attachments/a1');
    expect(el().querySelector('.tile .pdf')!.textContent).toContain('PDF');
    expect(el().textContent).toContain('2/10');
  });

  it('previews an image in an <img> and a PDF in a frame', () => {
    open();

    details.open(ATTACHMENTS[0] as never);
    fixture.detectChanges();
    expect(el().querySelector('.pbody img')!.getAttribute('src')).toBe('/api/expenses/e1/attachments/a1');

    details.open(ATTACHMENTS[1] as never);
    fixture.detectChanges();
    expect(el().querySelector('.pbody iframe')!.getAttribute('src')).toBe('/api/expenses/e1/attachments/a2');
  });

  it('downloads through ?download=1', () => {
    open();
    const links = Array.from(el().querySelectorAll('a.act')).map(a => a.getAttribute('href'));
    expect(links).toEqual(['/api/expenses/e1/attachments/a1?download=1', '/api/expenses/e1/attachments/a2?download=1']);
  });

  it('removes one file after asking, and only that one', () => {
    open();
    let count = -1;
    details.countChange.subscribe(n => (count = n));

    details.askRemove(ATTACHMENTS[0] as never);
    fixture.detectChanges();
    expect(el().querySelector('.et-popup')!.textContent).toContain('The expense, its amount and your balances stay');

    details.remove();
    const req = http.expectOne('/api/expenses/e1/attachments/a1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(details.attachments.map(a => a.id)).toEqual(['a2']);
    expect(count).toBe(1);
  });

  it('without "Remove entries" there is no remove button', () => {
    open(false);
    expect(el().querySelector('.act.danger')).toBeNull();
    expect(el().querySelectorAll('a.act').length).toBe(2);
  });
});
