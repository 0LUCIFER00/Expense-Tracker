import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RecentlyDeletedComponent } from './recently-deleted.component';
import { DeletedEntry, RecycleBin } from '../../shared/models';

function entry(overrides: Partial<DeletedEntry> = {}): DeletedEntry {
  return {
    kind: 'expense',
    id: 'e1',
    description: 'Lunch',
    amountPaise: 25000,
    date: '2026-10-30',
    category: 'Food & Drink',
    account: 'HDFC Bank',
    pending: false,
    deletedAt: '2026-11-08T10:00:00.000Z',
    deletedVia: 'user',
    expiresAt: '2026-12-08T10:00:00.000Z',
    daysLeft: 28,
    movedMoney: true,
    splitMembers: null,
    repays: null,
    attachmentCount: 0,
    ...overrides
  };
}

describe('RecentlyDeletedComponent', () => {
  let fixture: ComponentFixture<RecentlyDeletedComponent>;
  let component: RecentlyDeletedComponent;
  let http: HttpTestingController;
  let el: HTMLElement;

  function open(entries: DeletedEntry[], canManage = true): void {
    TestBed.configureTestingModule({
      imports: [RecentlyDeletedComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RecentlyDeletedComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();

    http.expectOne('/api/recycle-bin').flush({ retentionDays: 30, canManage, entries } satisfies RecycleBin);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  const rows = () => Array.from(el.querySelectorAll('.bin-row:not(.bin-labels)'));
  const button = (text: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent!.trim() === text)!;
  /** A button in the confirmation, which shares its words with the row's. */
  const dialogButton = (text: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(b => b.textContent!.trim() === text)!;

  const salary = entry({ kind: 'income', id: 'i1', description: 'Salary', amountPaise: 3000000, account: 'Cash', daysLeft: 2 });

  it('lists each entry with type, amount, account, both dates and the days left', () => {
    open([entry({ attachmentCount: 2 }), salary]);

    expect(rows().length).toBe(2);
    const first = rows()[0].textContent!;
    expect(first).toContain('Lunch');
    expect(first).toContain('Expense');
    expect(first).toContain('−₹250');
    expect(first).toContain('HDFC Bank');
    expect(first).toContain('30 Oct 2026');
    expect(first).toContain('Deleted 8 Nov 2026');
    expect(first).toContain('28 days');
    expect(first).toContain('2 receipts');

    const second = rows()[1];
    expect(second.textContent).toContain('+₹30,000');
    expect(second.querySelector('.left-pill')!.classList).toContain('soon');
  });

  it('filters by Expenses or Income and searches descriptions', () => {
    open([entry(), salary, entry({ id: 'e2', description: 'Lunch with team' })]);

    component.setKind('income');
    fixture.detectChanges();
    expect(rows().map(r => r.querySelector('.b-text')!.textContent)).toEqual(['Salary']);

    component.setKind('all');
    component.search = 'TEAM';
    fixture.detectChanges();
    expect(rows().map(r => r.querySelector('.b-text')!.textContent)).toEqual(['Lunch with team']);
  });

  it('says so when there is nothing in it', () => {
    open([]);

    expect(el.textContent).toContain('Nothing here');
    expect(button('Empty').disabled).toBeTrue();
  });

  it('asks before restoring, saying where the money goes, then restores and asks the list to reload', () => {
    open([entry()]);
    const restored = spyOn(component.restored, 'emit');

    (el.querySelector('.act.restore') as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialog = el.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Restore Lunch?');
    expect(dialog.textContent).toContain('₹250 is taken out of HDFC Bank again.');
    http.expectNone('/api/recycle-bin/expense/e1/restore');

    dialogButton('Restore').click();
    const req = http.expectOne('/api/recycle-bin/expense/e1/restore');
    expect(req.request.method).toBe('POST');
    req.flush({ kind: 'expense', id: 'e1', description: 'Lunch', movedMoney: true, account: 'HDFC Bank', balanceAfter: null, budgetAlerts: [] });

    http.expectOne('/api/recycle-bin').flush({ retentionDays: 30, canManage: true, entries: [] });
    fixture.detectChanges();

    expect(restored).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('keeps a refusal on screen with its reason, and changes nothing', () => {
    open([entry()]);
    const restored = spyOn(component.restored, 'emit');

    component.ask({ action: 'restore', entry: component.entries[0] });
    component.confirm();
    http.expectOne('/api/recycle-bin/expense/e1/restore')
      .flush({ error: 'Not enough in HDFC Bank to restore this.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(el.querySelector('.confirm-error')!.textContent).toContain('Not enough in HDFC Bank');
    expect(restored).not.toHaveBeenCalled();
    expect(component.confirming).not.toBeNull();
  });

  it('explains a pending entry and a repayment before restoring them', () => {
    open([entry({ pending: true, movedMoney: false }), entry({ kind: 'income', id: 'r1', description: 'Asha share', repays: 'Dinner' })]);

    component.ask({ action: 'restore', entry: component.entries[0] });
    expect(component.confirmBody.join(' ')).toContain('still waiting for approval');

    component.ask({ action: 'restore', entry: component.entries[1] });
    expect(component.confirmBody.join(' ')).toContain('paying back Dinner again');
    expect(component.confirmBody.join(' ')).toContain('goes back into HDFC Bank');
  });

  it('asks before deleting for good, warning it cannot be undone and naming the receipts', () => {
    open([entry({ attachmentCount: 1 })]);

    (el.querySelector('.act.purge') as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialog = el.querySelector('[role="alertdialog"]')!.textContent!;
    expect(dialog).toContain('Delete Lunch for good?');
    expect(dialog).toContain('cannot be undone');
    expect(dialog).toContain('Its 1 receipt is deleted too');

    dialogButton('Delete for good').click();
    const req = http.expectOne('/api/recycle-bin/expense/e1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ purged: 1 });
    http.expectOne('/api/recycle-bin').flush({ retentionDays: 30, canManage: true, entries: [] });
  });

  it('empties only after confirming, and says how many go', () => {
    open([entry(), salary]);

    button('Empty').click();
    fixture.detectChanges();
    expect(el.querySelector('[role="alertdialog"]')!.textContent).toContain('All 2 entries are deleted for good');

    dialogButton('Empty it').click();
    const req = http.expectOne('/api/recycle-bin/empty');
    expect(req.request.body).toEqual({ confirm: 'empty' });
    req.flush({ purged: 2 });
    http.expectOne('/api/recycle-bin').flush({ retentionDays: 30, canManage: true, entries: [] });
  });

  it('Cancel closes the question without sending anything', () => {
    open([entry()]);

    component.ask({ action: 'purge', entry: component.entries[0] });
    fixture.detectChanges();
    dialogButton('Cancel').click();
    fixture.detectChanges();

    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('without "Remove entries" the list is shown but offers no actions', () => {
    open([entry()], false);

    expect(el.querySelector('.act')).toBeNull();
    expect(el.textContent).not.toContain('Empty');
    expect(el.textContent).toContain('need "Remove entries"');
  });
});
