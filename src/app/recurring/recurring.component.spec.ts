import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RecurringComponent } from './recurring.component';
import { RecurringEditorComponent, RecurringSave } from './recurring-editor/recurring-editor.component';
import { RecurringOverview, RecurringSchedule } from '../shared/models';

const TODAY = '2026-11-06';

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    id: 's1', kind: 'expense', description: 'Rent', amount: 15000, category: 'Bills & Utilities',
    accountId: 'a1', accountName: 'HDFC Bank', accountMissing: false,
    frequency: 'monthly', interval: 1, startOn: '2026-01-05', anchorOn: '2026-01-05',
    nextDueOn: '2026-12-05', endOn: null, remindDays: 1, status: 'active',
    postedCount: 11, reminderDue: false, nextDates: ['2026-12-05'],
    ...overrides
  };
}

function overview(overrides: Partial<RecurringOverview> = {}): RecurringOverview {
  return {
    today: TODAY,
    canManage: true,
    schedules: [
      schedule(),
      schedule({ id: 's2', description: 'Netflix', amount: 649, status: 'paused', nextDueOn: '2026-11-15' }),
      schedule({ id: 's3', kind: 'income', description: 'Salary', amount: 75000, category: 'Salary', nextDueOn: '2026-12-01' })
    ],
    upcoming: [],
    overdue: [{
      type: 'failed',
      run: {
        id: 'r1', scheduleId: 's1', dueOn: '2026-11-03', kind: 'expense', description: 'Car insurance',
        amount: 8000, status: 'failed', attempts: 3, error: 'Insufficient balance.', lastAttemptOn: '2026-11-05'
      }
    }],
    recent: [],
    summary: { active: 2, dueThisWeek: 0, attention: 1, monthlyOut: 15000, monthlyIn: 75000 },
    ...overrides
  };
}

const NO_SYNC = { today: TODAY, added: [], failed: [], attention: 1, reminders: [], budgetAlerts: [] };

describe('RecurringComponent', () => {
  let fixture: ComponentFixture<RecurringComponent>;
  let component: RecurringComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RecurringComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RecurringComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => http.verify());

  const host = () => fixture.nativeElement as HTMLElement;

  /** Opens the page: lists for the form, then sync, then the overview. */
  function open(body: RecurringOverview = overview()) {
    fixture.detectChanges();
    http.expectOne('/api/balances').flush([{ id: 'a1', type: 'Bank', category: 'HDFC Bank', balance: null, saved: true, hidden: true }]);
    http.expectOne('/api/expenses/categories').flush(['Bills & Utilities']);
    http.expectOne('/api/incomes/categories').flush(['Salary']);
    const sync = http.expectOne('/api/recurring/sync');
    expect(sync.request.method).toBe('POST');
    sync.flush(NO_SYNC);
    http.expectOne('/api/recurring').flush(body);
    fixture.detectChanges();
  }

  it('adds what is due before showing the schedules', () => {
    open();

    expect(host().textContent).toContain('Rent');
    expect(host().textContent).toContain('Monthly on the 5th');
    expect(host().querySelectorAll('.rows .row:not(.head)').length).toBe(3);
  });

  it('shows what needs attention with try again and skip', () => {
    open();

    const attention = host().querySelector('.attention')!;
    expect(attention.textContent).toContain('Car insurance');
    expect(attention.textContent).toContain('Insufficient balance.');
    expect(attention.querySelectorAll('button').length).toBe(2);
  });

  it('filters by tab', () => {
    open();

    component.setTab('income');
    fixture.detectChanges();
    expect(host().querySelectorAll('.rows .row:not(.head)').length).toBe(1);

    component.setTab('inactive');
    fixture.detectChanges();
    expect(host().textContent).toContain('Netflix');
    expect(host().querySelectorAll('.rows .row:not(.head)').length).toBe(1);
  });

  it('without Manage recurring there are no buttons to change anything', () => {
    open(overview({ canManage: false }));

    expect(host().querySelector('.new-btn')).toBeNull();
    expect(host().querySelector('.ib')).toBeNull();
    expect(host().querySelector('.att-acts')).toBeNull();
  });

  it('pausing calls the API and reloads', () => {
    open();

    component.onTogglePause(component.view!.schedules[0]);
    http.expectOne('/api/recurring/s1/pause').flush(schedule({ status: 'paused' }));
    http.expectOne('/api/recurring/sync').flush(NO_SYNC);
    http.expectOne('/api/recurring').flush(overview());
  });

  it('deleting asks first, and says the entries stay', () => {
    open();

    component.onAskDelete(component.view!.schedules[0]);
    fixture.detectChanges();

    const popup = host().querySelector('.et-popup')!;
    expect(popup.textContent).toContain('11');
    expect(popup.textContent).toContain('stay in');
    http.expectNone('/api/recurring/s1');

    component.onConfirmDelete();
    const request = http.expectOne('/api/recurring/s1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    http.expectOne('/api/recurring').flush(overview());
  });
});

describe('RecurringEditorComponent', () => {
  let fixture: ComponentFixture<RecurringEditorComponent>;
  let editor: RecurringEditorComponent;
  let saved: RecurringSave | null;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [RecurringEditorComponent] });
    fixture = TestBed.createComponent(RecurringEditorComponent);
    editor = fixture.componentInstance;
    editor.today = TODAY;
    editor.accounts = [{ id: 'a1', type: 'Bank', category: 'HDFC Bank', balance: null, saved: true, hidden: true }];
    saved = null;
    editor.save.subscribe(value => (saved = value));
  });

  it('a new schedule starts today and sends startOn', () => {
    fixture.detectChanges();
    editor.description = 'Gym';
    editor.amount = 1200;
    editor.onSubmit();

    expect(saved!.draft.startOn).toBe(TODAY);
    expect(saved!.draft.nextDueOn).toBeUndefined();
    expect(saved!.draft.accountId).toBe('a1');
    expect(saved!.draft.frequency).toBe('monthly');
    expect(saved!.draft.interval).toBe(1);
  });

  it('custom repeats send the unit and interval', () => {
    fixture.detectChanges();
    editor.description = 'Cleaner';
    editor.amount = 500;
    editor.repeat = 'custom';
    editor.customEvery = 2;
    editor.customUnit = 'weekly';
    editor.onSubmit();

    expect(saved!.draft.frequency).toBe('weekly');
    expect(saved!.draft.interval).toBe(2);
  });

  it('refuses a past start date without the permission, and a bad amount', () => {
    fixture.detectChanges();
    editor.description = 'Gym';
    editor.amount = 1200;
    editor.firstDate = '2026-11-01';
    editor.onSubmit();
    expect(saved).toBeNull();
    expect(editor.error).toContain('today or later');

    editor.firstDate = TODAY;
    editor.amount = 0;
    editor.onSubmit();
    expect(saved).toBeNull();
  });

  it('shows the month-end dates for a schedule on the 31st', () => {
    fixture.detectChanges();
    editor.firstDate = '2027-01-31';
    fixture.detectChanges();

    expect(editor.preview).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    expect(editor.monthEndNote).toBeTrue();
  });

  it('an edit sends nextDueOn and keeps the kind', () => {
    editor.schedule = schedule({ kind: 'income', accountId: 'a1' });
    fixture.detectChanges();
    editor.amount = 16000;
    editor.onSubmit();

    expect(saved!.draft.kind).toBe('income');
    expect(saved!.draft.nextDueOn).toBe('2026-12-05');
    expect(saved!.draft.startOn).toBeUndefined();
    expect(saved!.active).toBeTrue();
  });
});
