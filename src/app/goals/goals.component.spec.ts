import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { GoalsComponent } from './goals.component';
import { GoalEditorComponent } from './goal-editor/goal-editor.component';
import { EntrySave, GoalEntryComponent } from './goal-entry/goal-entry.component';
import { GoalDraft, GoalsOverview, SavingsGoal } from '../shared/models';

const TODAY = '2026-11-06';

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'g1', name: 'Emergency fund', description: 'Six months of rent', icon: 'emergency',
    target: 150000, saved: 92000, remaining: 58000, over: 0, percent: 61,
    targetDate: '2027-03-31', monthsLeft: 5, monthly: 11600, status: 'active', state: 'on-track',
    createdOn: '2026-09-01', completedAt: null,
    ...overrides
  };
}

function overview(overrides: Partial<GoalsOverview> = {}): GoalsOverview {
  return {
    today: TODAY,
    canManage: true,
    goals: [
      goal(),
      goal({ id: 'g2', name: 'Goa trip', targetDate: '2026-12-20', state: 'behind', icon: 'travel' }),
      goal({ id: 'g3', name: 'Bike', status: 'completed', state: 'completed', monthly: null }),
      goal({ id: 'g4', name: 'Wedding gift', status: 'paused', state: 'paused' })
    ],
    summary: { totalTarget: 600000, totalSaved: 368000, percent: 61, active: 2, paused: 1, completed: 1 },
    ...overrides
  };
}

describe('GoalsComponent', () => {
  let fixture: ComponentFixture<GoalsComponent>;
  let component: GoalsComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GoalsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GoalsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => http.verify());

  const host = () => fixture.nativeElement as HTMLElement;

  /** Opens the page; the first active goal (soonest date) is chosen and its history loaded. */
  function open(body: GoalsOverview = overview()) {
    fixture.detectChanges();
    http.expectOne('/api/goals').flush(body);
    fixture.detectChanges();
  }

  it('shows the totals and the active goals, soonest first, with the first one open', () => {
    open();
    http.expectOne('/api/goals/g2/activity').flush([]);
    fixture.detectChanges();

    // The app formats in en-IN (6,00,000); the test bed in en-US (600,000).
    expect(host().querySelector('.summary')!.textContent).toMatch(/₹6,?00,000/);
    const names = Array.from(host().querySelectorAll('.goal .name')).map(el => el.textContent!.trim());
    expect(names).toEqual(['Goa trip', 'Emergency fund']);
    expect(host().querySelector('.detail h2')!.textContent).toContain('Goa trip');
  });

  it('shows the history of the chosen goal with the total each entry left', () => {
    open();
    http.expectOne('/api/goals/g2/activity').flush([]);

    component.select(component.view!.goals[0], false);
    http.expectOne('/api/goals/g1/activity').flush([
      { id: 'a1', kind: 'withdrawal', amount: 8000, date: '2026-10-18', note: 'Car repair', savedAfter: 82000, createdAt: '' },
      { id: 'a2', kind: 'contribution', amount: 90000, date: '2026-09-01', note: null, savedAfter: 90000, createdAt: '' }
    ]);
    fixture.detectChanges();

    const rows = host().querySelectorAll('.h-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Withdrawn');
    expect(rows[0].textContent).toContain('Car repair');
    expect(rows[0].textContent).toContain('82,000');
  });

  it('filters by status', () => {
    open();
    http.expectOne('/api/goals/g2/activity').flush([]);

    component.setTab('completed');
    http.expectOne('/api/goals/g3/activity').flush([]);
    fixture.detectChanges();
    expect(Array.from(host().querySelectorAll('.goal .name')).map(el => el.textContent!.trim())).toEqual(['Bike']);
    expect(host().textContent).toContain('Reopen');
    expect(host().querySelector('.d-actions')).toBeNull();
  });

  it('without Manage savings goals there is nothing to press', () => {
    open(overview({ canManage: false }));
    http.expectOne('/api/goals/g2/activity').flush([]);
    fixture.detectChanges();

    expect(host().querySelector('.new-btn')).toBeNull();
    expect(host().querySelector('.d-actions')).toBeNull();
    expect(host().querySelector('.d-links')).toBeNull();
  });

  it('adding money posts to the chosen goal and reloads', () => {
    open();
    http.expectOne('/api/goals/g2/activity').flush([]);

    component.onSaveEntry({ kind: 'contribution', amount: 6750, date: TODAY, note: null });
    const req = http.expectOne('/api/goals/g2/contributions');
    expect(req.request.body).toEqual({ amount: 6750, date: TODAY, note: null });
    req.flush({ goal: goal({ id: 'g2' }), entry: {} });

    http.expectOne('/api/goals').flush(overview());
    http.expectOne('/api/goals/g2/activity').flush([]);
  });

  it('deleting asks first and says nothing else changes', () => {
    open();
    http.expectOne('/api/goals/g2/activity').flush([]);

    component.onAskDelete(component.view!.goals[1]);
    fixture.detectChanges();
    expect(host().querySelector('.et-popup')!.textContent).toContain("don't change");
    http.expectNone('/api/goals/g2');

    component.onConfirmDelete();
    const req = http.expectOne('/api/goals/g2');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    http.expectOne('/api/goals').flush(overview());
    http.expectOne('/api/goals/g2/activity').flush([]);
  });

  it('invites a first goal when there are none', () => {
    open(overview({ goals: [], summary: { totalTarget: 0, totalSaved: 0, percent: 0, active: 0, paused: 0, completed: 0 } }));
    expect(host().textContent).toContain('No goals yet');
    expect(host().textContent).toContain('Start a goal');
  });
});

describe('GoalEditorComponent', () => {
  let fixture: ComponentFixture<GoalEditorComponent>;
  let editor: GoalEditorComponent;
  let saved: GoalDraft | null;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [GoalEditorComponent] });
    fixture = TestBed.createComponent(GoalEditorComponent);
    editor = fixture.componentInstance;
    editor.today = TODAY;
    saved = null;
    editor.save.subscribe(value => (saved = value));
  });

  it('a new goal sends its target, date, icon and what is already saved', () => {
    fixture.detectChanges();
    editor.name = ' Goa trip ';
    editor.target = 40000;
    editor.targetDate = '2026-12-20';
    editor.initialSaved = 20000;
    editor.pickIcon('travel');
    editor.onSubmit();

    expect(saved).toEqual({
      name: 'Goa trip', description: null, icon: 'travel', target: 40000, targetDate: '2026-12-20', initialSaved: 20000
    });
  });

  it('guides the monthly amount with the server rule: months rounded up', () => {
    fixture.detectChanges();
    editor.target = 40000;
    editor.initialSaved = 20000;
    editor.targetDate = '2026-12-20';

    expect(editor.months).toBe(2);
    expect(editor.monthlyGuide).toBe(10000);
  });

  it('refuses a past date, a missing name and more than two decimals', () => {
    fixture.detectChanges();
    editor.name = 'x';
    editor.target = 100;
    editor.targetDate = '2026-11-01';
    editor.onSubmit();
    expect(saved).toBeNull();

    editor.targetDate = TODAY;
    editor.target = 1.234;
    editor.onSubmit();
    expect(saved).toBeNull();

    editor.target = 100;
    editor.name = ' ';
    editor.onSubmit();
    expect(saved).toBeNull();
  });

  it('an edit keeps a date that has already passed and sends no starting amount', () => {
    editor.goal = goal({ targetDate: '2026-11-01' });
    fixture.detectChanges();
    editor.initialSaved = 500;
    editor.onSubmit();

    expect(saved!.targetDate).toBe('2026-11-01');
    expect(saved!.initialSaved).toBeUndefined();
  });
});

describe('GoalEntryComponent', () => {
  let fixture: ComponentFixture<GoalEntryComponent>;
  let entry: GoalEntryComponent;
  let saved: EntrySave | null;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [GoalEntryComponent] });
    fixture = TestBed.createComponent(GoalEntryComponent);
    entry = fixture.componentInstance;
    entry.goal = goal();
    entry.today = TODAY;
    saved = null;
    entry.save.subscribe(value => (saved = value));
    fixture.detectChanges();
  });

  it('offers this month’s share and everything left, and previews the total in paise', () => {
    expect(entry.quick.map(q => q.amount)).toEqual([11600, 58000]);
    entry.amount = 0.1;
    expect(entry.after).toBe(92000.1);
  });

  it('refuses a withdrawal larger than the goal holds', () => {
    entry.setKind('withdrawal');
    entry.amount = 92000.01;
    entry.onSubmit();
    expect(saved).toBeNull();
    expect(entry.error).toContain('92,000');

    entry.amount = 92000;
    entry.onSubmit();
    expect(saved).toEqual({ kind: 'withdrawal', amount: 92000, date: TODAY, note: null });
  });

  it('refuses a future date', () => {
    entry.amount = 100;
    entry.date = '2026-11-07';
    entry.onSubmit();
    expect(saved).toBeNull();
  });
});
