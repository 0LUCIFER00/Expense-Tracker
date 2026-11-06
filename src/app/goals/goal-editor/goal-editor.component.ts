import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GoalDraft, GoalIcon, SavingsGoal } from '../../shared/models';
import { GOAL_ICONS, goalDate } from '../../shared/goals.service';

const TARGET_MAX = 99_99_99_999.99;
const ENTRY_MAX = 1_00_00_000;

/**
 * The New / Edit goal form, shown over the page. It checks what was typed and
 * hands back a draft; the server checks everything again and works out every
 * figure. The monthly preview here is only a guide while typing.
 */
@Component({
  selector: 'app-goal-editor',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './goal-editor.component.html',
  styleUrl: './goal-editor.component.css'
})
export class GoalEditorComponent implements OnInit {
  /** Null for a new goal. */
  @Input() goal: SavingsGoal | null = null;
  @Input() today = '';
  @Input() busy = false;

  @Output() save = new EventEmitter<GoalDraft>();
  @Output() cancel = new EventEmitter<void>();

  name = '';
  description = '';
  icon: GoalIcon | null = 'piggy';
  target: number | null = null;
  targetDate = '';
  initialSaved: number | null = null;
  error = '';

  readonly icons = GOAL_ICONS;
  readonly goalDate = goalDate;

  get editing(): boolean {
    return this.goal !== null;
  }

  /** Whole months to the date, rounded up, at least 1 (the server's rule). */
  get months(): number {
    if (!this.targetDate || !this.today || this.targetDate < this.today) return 0;
    const [y, m, d] = this.today.split('-').map(Number);
    const [ty, tm, td] = this.targetDate.split('-').map(Number);
    return Math.max(1, (ty - y) * 12 + (tm - m) + (td > d ? 1 : 0));
  }

  get toGo(): number {
    const saved = this.editing ? this.goal!.saved : Number(this.initialSaved || 0);
    return Math.max(0, Number(this.target || 0) - saved);
  }

  /** A guide while typing; the page shows the server's own figure once saved. */
  get monthlyGuide(): number | null {
    return this.months > 0 && this.toGo > 0 ? Math.ceil((this.toGo * 100) / this.months) / 100 : null;
  }

  ngOnInit(): void {
    const g = this.goal;

    if (g) {
      this.name = g.name;
      this.description = g.description ?? '';
      this.icon = g.icon;
      this.target = g.target;
      this.targetDate = g.targetDate;
    }
  }

  pickIcon(key: GoalIcon): void {
    this.icon = this.icon === key ? null : key;
  }

  onSubmit(): void {
    this.error = this.check();

    if (this.error) {
      return;
    }

    const draft: GoalDraft = {
      name: this.name.trim(),
      description: this.description.trim() || null,
      icon: this.icon,
      target: Number(this.target),
      targetDate: this.targetDate
    };

    if (!this.editing && this.initialSaved) {
      draft.initialSaved = Number(this.initialSaved);
    }

    this.save.emit(draft);
  }

  private check(): string {
    const target = Number(this.target);
    const twoDecimals = (n: number) => Math.round(n * 100) === n * 100;

    if (!this.name.trim()) return 'Give the goal a name.';
    if (!(target > 0) || target > TARGET_MAX || !twoDecimals(target)) {
      return 'Enter a target above ₹0 with at most two decimal places.';
    }
    if (!this.targetDate) return 'Choose a target date.';
    if (this.targetDate < this.today && this.targetDate !== this.goal?.targetDate) {
      return 'The target date must be today or later.';
    }
    if (!this.editing && this.initialSaved !== null && String(this.initialSaved) !== '') {
      const initial = Number(this.initialSaved);
      if (!(initial > 0) || initial > ENTRY_MAX || !twoDecimals(initial)) {
        return 'Already saved must be above ₹0 and no more than ₹1,00,00,000, or left empty.';
      }
    }

    return '';
  }
}
