import { DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GoalsOverview, SavingsGoal } from '../../shared/models';
import { goalDate } from '../../shared/goals.service';

/**
 * Savings goals on Home, as one of the strips under the spending card: the
 * total saved against the total target, and the goal due soonest. It only
 * reads; nothing here moves money.
 */
@Component({
  selector: 'app-goals-strip',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  template: `
    <section class="et-strip goals-strip">
      <span class="et-strip-icon goals" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M5 11a7 6 0 0 1 13-2h2v4h-2l-1 3v3h-3v-2H9v2H6v-3c-1-1-1-2-1-5zM14 8V6" />
        </svg>
      </span>
      <div class="et-strip-text">
        @if (goals.goals.length) {
          <p class="et-strip-title">
            Savings goals · <span class="tnum">₹{{ goals.summary.totalSaved | number: '1.0-0' }}</span>
            of <span class="tnum">₹{{ goals.summary.totalTarget | number: '1.0-0' }}</span>
          </p>
          <span class="et-meter" role="img" [attr.aria-label]="goals.summary.percent + '% of all targets saved'">
            <span class="et-meter-fill" [style.width.%]="width"></span>
          </span>
          <p class="et-strip-body">
            {{ goals.summary.percent }}% saved
            @if (next; as n) {
              · Next: <strong>{{ n.name }}</strong>, ₹{{ n.remaining | number: '1.0-0' }}
              {{ n.targetDate < goals.today ? 'was due' : 'by' }} {{ date(n.targetDate) }}
            } @else {
              ·
              Every active goal has reached its target.
            }
          </p>
        } @else {
          <p class="et-strip-title">Savings goals</p>
          <p class="et-strip-body">Put money aside for a trip, a gadget or a rainy day, and see how much to save each month.</p>
        }
      </div>
      <a class="secondary-action" routerLink="/goals">{{ goals.goals.length ? 'See all' : 'Start a goal' }}</a>
    </section>
  `,
  styles: [`
    :host { display: contents; }
    .et-strip-icon.goals { background-color: var(--accent-soft); color: var(--accent-ink); }
    .et-meter { margin: 0.25rem 0 0.3rem; height: 6px; }
    /* The same button the other strips use; theirs is scoped to each layout. */
    .secondary-action {
      flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 42px; padding: 0 1.125rem;
      border-radius: 10px; font-size: 0.875rem; font-weight: 700; text-decoration: none;
      border: 1px solid var(--accent); color: var(--accent-ink);
    }
    .secondary-action:hover { background-color: var(--accent-soft); }
    @media (max-width: 480px) { .secondary-action { flex: 1 1 100%; justify-content: center; } }
    /* Beside the WhatsApp strip on a desktop: the button stays on the line. */
    @media (min-width: 900px) {
      .et-strip { flex-wrap: nowrap; }
      .et-strip-text { flex: 1 1 0; }
    }
    /* As the other strips do on a short laptop screen. */
    @media (min-width: 900px) and (min-height: 560px) and (max-height: 760px) {
      .et-strip { padding: 0.5rem 1rem; }
      .secondary-action { min-height: 36px; padding: 0 0.875rem; }
    }
  `]
})
export class GoalsStripComponent {
  @Input({ required: true }) goals!: GoalsOverview;

  readonly date = goalDate;

  get width(): number {
    return Math.min(100, Math.max(0, this.goals.summary.percent));
  }

  /** The active goal still short whose date comes soonest; an overdue one first. */
  get next(): SavingsGoal | null {
    return this.goals.goals
      .filter(goal => goal.status === 'active' && goal.remaining > 0)
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0] ?? null;
  }
}
