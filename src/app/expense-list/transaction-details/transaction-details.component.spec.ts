import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TransactionDetailsComponent } from './transaction-details.component';
import { Expense, Income, SplitSummary } from '../../shared/models';

const EXPENSE = {
  id: 'e1', amount: 1455, description: 'Vegetables', date: '2026-11-09', category: 'Groceries',
  sourceId: 'b1', sourceType: 'Bank Account', sourceCategory: 'HDFC Bank', expenseAccess: true,
  updatePermission: true, balanceUpdated: true, status: 'Done', remarks: null, isPendingApproval: false,
  createdAt: '', attachmentCount: 2
} as unknown as Expense;

const INCOME: Income = {
  id: 'i1', amount: 364, description: 'Kalai share', date: '2026-11-10', category: null,
  targetId: 'b1', targetType: 'Bank Account', targetCategory: 'HDFC Bank', balanceUpdated: true,
  createdAt: '', splitExpenseId: 'e1', splitDescription: 'Vegetables'
};

const SPLIT: SplitSummary = {
  id: 'e1', description: 'Vegetables', date: '2026-11-09', status: 'done', amount: 1455, members: 4,
  share: 364, personal: 363, owed: 1092, received: 364, remaining: 728,
  repayments: [{ id: 'i1', amount: 364, description: 'Kalai share', date: '2026-11-10', account: 'HDFC Bank' }]
};

const ATTACHMENTS = [
  { id: 'a1', expenseId: 'e1', fileName: 'bill.jpg', contentType: 'image/jpeg', size: 120000, createdAt: '' },
  { id: 'a2', expenseId: 'e1', fileName: 'invoice.pdf', contentType: 'application/pdf', size: 300000, createdAt: '' }
];

describe('TransactionDetailsComponent', () => {
  let fixture: ComponentFixture<TransactionDetailsComponent>;
  let details: TransactionDetailsComponent;
  let http: HttpTestingController;

  function open(set: Partial<TransactionDetailsComponent> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TransactionDetailsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TransactionDetailsComponent);
    details = fixture.componentInstance;
    // As inputs, the way the list sets them, so ngOnChanges runs.
    for (const [key, value] of Object.entries({ expense: EXPENSE, canRemove: true, ...set })) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();

    if (details.expense) {
      http.expectOne(`/api/expenses/${details.expense.id}/attachments`).flush(ATTACHMENTS);
      fixture.detectChanges();
    }
  }

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;

  describe('an expense', () => {
    it('shows the amount, the account it was paid from and when it was added', () => {
      open();

      expect(el().querySelector('h2')!.textContent).toContain('Vegetables');
      expect(el().querySelector('.amount')!.textContent).toContain('−₹1,455');
      expect(el().querySelector('.facts')!.textContent).toContain('Paid from');
      expect(el().querySelector('.facts')!.textContent).toContain('HDFC Bank');
      expect(el().querySelector('.status')!.textContent).toContain('Completed');
    });

    it('shows where an imported entry came from, with its notes and payment method', () => {
      open({
        expense: {
          ...EXPENSE,
          createdAt: '2026-11-09T10:00:00.000Z',
          imported: { fileName: 'november.csv', notes: 'Team lunch', paymentMethod: 'UPI' }
        }
      });

      const facts = el().querySelector('.facts')!.textContent!;
      expect(facts).toContain('From november.csv');
      expect(facts).toContain('Payment method');
      expect(facts).toContain('UPI');
      expect(facts).toContain('Team lunch');
    });

    it('shows no import facts for an entry added by hand', () => {
      open();
      expect(el().querySelector('.facts')!.textContent).not.toContain('Notes');
    });

    it('hides the account where this sign-in may not see it', () => {
      open({ canViewSource: false });
      expect(el().querySelector('.facts')!.textContent).not.toContain('HDFC Bank');
    });

    it('shows a thumbnail for an image and a PDF tile, from this site\'s own API', () => {
      open();
      const img = el().querySelector('.tile img') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/api/expenses/e1/attachments/a1');
      expect(el().querySelector('.tile .pdf')!.textContent).toContain('PDF');
    });

    it('previews an image in an <img> and a PDF in a frame, with Download', () => {
      open();
      const tiles = el().querySelectorAll('.tile') as NodeListOf<HTMLButtonElement>;

      tiles[0].click();
      fixture.detectChanges();
      expect(el().querySelector('.pbody img')!.getAttribute('src')).toBe('/api/expenses/e1/attachments/a1');
      expect(el().querySelector('.phead a')!.getAttribute('href')).toBe('/api/expenses/e1/attachments/a1?download=1');

      details.closePreview();
      tiles[1].click();
      fixture.detectChanges();
      expect(el().querySelector('.pbody iframe')!.getAttribute('src')).toBe('/api/expenses/e1/attachments/a2');
    });

    it('removes one file after asking, and only that one', () => {
      open();
      const counts: number[] = [];
      details.countChange.subscribe(n => counts.push(n));

      (el().querySelector('.tile') as HTMLButtonElement).click();
      fixture.detectChanges();
      (el().querySelector('.phead .btn.danger') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el().querySelector('.et-popup')!.textContent).toContain('The expense, its amount and your balances stay');

      (el().querySelector('.et-popup .et-btn-danger') as HTMLButtonElement).click();
      http.expectOne(req => req.method === 'DELETE' && req.url === '/api/expenses/e1/attachments/a1').flush(null);
      fixture.detectChanges();

      expect(details.attachments.map(a => a.id)).toEqual(['a2']);
      expect(counts).toEqual([1]);
    });

    it('asks before removing the entry, and says where the money goes', () => {
      open();
      let removed = 0;
      details.remove.subscribe(() => removed++);

      (el().querySelector('.foot .btn.danger') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(removed).toBe(0);
      expect(el().querySelector('.foot')!.textContent).toContain('Removing puts ₹1,455 back in HDFC Bank; you can restore it for 30 days.');

      (el().querySelector('.foot .btn.danger-solid') as HTMLButtonElement).click();
      expect(removed).toBe(1);
    });

    it('without "Remove entries" there is no remove, for the entry or its files', () => {
      open({ canRemove: false });
      expect(el().querySelector('.foot')).toBeNull();

      (el().querySelector('.tile') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el().querySelector('.phead .btn.danger')).toBeNull();
    });

    it('offers Approve on a pending expense to someone who may approve', () => {
      open({ expense: { ...EXPENSE, isPendingApproval: true } as Expense, canApprove: true });
      let approved = 0;
      details.approve.subscribe(() => approved++);

      expect(el().querySelector('.status')!.textContent).toContain('Pending approval');
      (el().querySelector('.foot .btn.good') as HTMLButtonElement).click();
      expect(approved).toBe(1);
    });

    it('lists who has paid back a split, and what is still to come', () => {
      open({ split: SPLIT });
      const text = el().querySelector('.block')!.textContent!;

      expect(text).toContain('Paid back');
      expect(text).toContain('₹364 of ₹1,092');
      expect(text).toContain('Kalai share');
      expect(text).toContain('₹728');
    });

    it('Escape closes the drawer', () => {
      open();
      let closed = 0;
      details.closed.subscribe(() => closed++);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(closed).toBe(1);
    });
  });

  describe('money in', () => {
    it('shows the amount in, where it went, and no receipts', () => {
      open({ expense: null, income: { ...INCOME, splitExpenseId: null, category: 'Salary' } });

      expect(el().querySelector('.amount')!.textContent).toContain('+₹364');
      expect(el().querySelector('.facts')!.textContent).toContain('Added to');
      expect(el().querySelector('.sub')!.textContent).toContain('Salary');
      expect(el().textContent).not.toContain('Receipts');
      expect(el().querySelector('.foot')!.textContent).toContain('Removing takes ₹364 back out of HDFC Bank; you can restore it for 30 days.');
    });

    it('links a repayment to the split it pays back', () => {
      open({ expense: null, income: INCOME, split: SPLIT });
      let opened = '';
      details.openSplit.subscribe(id => (opened = id));

      expect(el().querySelector('.sub')!.textContent).toContain('Repayment');

      const link = el().querySelector('.split-link') as HTMLButtonElement;
      expect(link.textContent).toContain('Vegetables');
      link.click();
      expect(opened).toBe('e1');
    });
  });
});
