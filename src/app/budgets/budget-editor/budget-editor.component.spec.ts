import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BudgetEditorComponent } from './budget-editor.component';
import { BudgetDraft } from '../../shared/models';

describe('BudgetEditorComponent', () => {
  let fixture: ComponentFixture<BudgetEditorComponent>;
  let editor: BudgetEditorComponent;
  let saved: BudgetDraft[];

  function make(draft: BudgetDraft, copiedFrom: string | null = null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [BudgetEditorComponent] });

    fixture = TestBed.createComponent(BudgetEditorComponent);
    editor = fixture.componentInstance;
    editor.draft = draft;
    editor.categoryNames = ['Food & Drink', 'Travel', 'Shopping', 'Uncategorised'];
    editor.monthName = 'November 2026';
    editor.copiedFrom = copiedFrom;
    editor.ngOnChanges();
    saved = [];
    editor.save.subscribe(draft => saved.push(draft));
    fixture.detectChanges();
  }

  it('starts from the draft it is given', () => {
    make({ total: 30000, categories: [{ category: 'Travel', amount: 3000 }] });

    expect(editor.total).toBe('30000');
    expect(editor.rows).toEqual([{ category: 'Travel', amount: '3000' }]);
  });

  it('offers only categories not already in the form', () => {
    make({ total: null, categories: [{ category: 'Travel', amount: 3000 }] });

    expect(editor.available).toEqual(['Food & Drink', 'Shopping', 'Uncategorised']);
  });

  it('adds up the categories, and says when they pass the overall figure', () => {
    make({ total: 5000, categories: [{ category: 'Travel', amount: 3000 }, { category: 'Shopping', amount: 2500 }] });

    expect(editor.allocated).toBe(5500);
    expect(editor.overAllocated).toBeTrue();
  });

  it('saves numbers, not text', () => {
    make({ total: null, categories: [] });

    editor.total = '30000';
    editor.adding = 'Travel';
    editor.onAdd();
    editor.rows[0].amount = '2999.50';
    editor.onSave();

    expect(saved).toEqual([{ total: 30000, categories: [{ category: 'Travel', amount: 2999.5 }] }]);
  });

  it('refuses amounts that are not positive money, and an empty budget', () => {
    make({ total: null, categories: [] });

    editor.onSave();
    expect(saved.length).toBe(0, 'nothing set');

    for (const bad of ['0', '-5', 'abc', '1e5', '10.999']) {
      editor.total = bad;
      editor.onSave();
      expect(saved.length).toBe(0, bad);
    }

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.et-field-error')).not.toBeNull();
  });

  it('only takes a removed row out of the form', () => {
    make({ total: 30000, categories: [{ category: 'Travel', amount: 3000 }] });

    editor.onRemove(editor.rows[0]);
    editor.onSave();

    expect(saved).toEqual([{ total: 30000, categories: [] }]);
  });

  it('says where copied amounts came from', () => {
    make({ total: 30000, categories: [] }, '2026-10');

    expect((fixture.nativeElement as HTMLElement).querySelector('.copied')?.textContent).toContain('October 2026');
  });
});
