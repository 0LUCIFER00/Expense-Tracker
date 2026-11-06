import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { GoalDraft, GoalEntry, GoalIcon, GoalState, GoalsOverview, SavingsGoal } from './models';

/**
 * Savings goals. Tracking only: nothing here moves money between accounts.
 * Every figure (saved, remaining, percentage, monthly amount, status) comes
 * from the API; the page only shows it.
 */
@Injectable({ providedIn: 'root' })
export class GoalsService {
  private readonly api = inject(ApiService);

  overview(): Observable<GoalsOverview> {
    return this.api.get<GoalsOverview>('/goals');
  }

  activity(id: string): Observable<GoalEntry[]> {
    return this.api.get<GoalEntry[]>(`/goals/${id}/activity`);
  }

  create(draft: GoalDraft): Observable<SavingsGoal> {
    return this.api.post<SavingsGoal>('/goals', draft);
  }

  update(id: string, draft: GoalDraft): Observable<SavingsGoal> {
    return this.api.put<SavingsGoal>(`/goals/${id}`, draft);
  }

  setStatus(id: string, action: 'pause' | 'resume' | 'complete' | 'reopen'): Observable<SavingsGoal> {
    return this.api.post<SavingsGoal>(`/goals/${id}/${action}`);
  }

  /** Deletes the goal and its history. Nothing outside the goal changes. */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/goals/${id}`);
  }

  addEntry(
    id: string,
    kind: 'contribution' | 'withdrawal',
    entry: { amount: number; date: string; note: string | null }
  ): Observable<{ goal: SavingsGoal; entry: GoalEntry }> {
    const path = kind === 'contribution' ? 'contributions' : 'withdrawals';
    return this.api.post<{ goal: SavingsGoal; entry: GoalEntry }>(`/goals/${id}/${path}`, entry);
  }
}

/** The icons a goal can have, as outline paths on a 24×24 grid. */
export const GOAL_ICONS: { key: GoalIcon; label: string; path: string }[] = [
  { key: 'piggy', label: 'Piggy bank', path: 'M5 11a7 6 0 0 1 13-2h2v4h-2l-1 3v3h-3v-2H9v2H6v-3c-1-1-1-2-1-5zM14 8V6' },
  { key: 'emergency', label: 'Emergency', path: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z' },
  { key: 'travel', label: 'Travel', path: 'M3 11l18-8-6 18-3-7-9-3z' },
  { key: 'home', label: 'Home', path: 'M3 11l9-7 9 7M5 10v10h14V10' },
  { key: 'vehicle', label: 'Vehicle', path: 'M5 16h14l-1.5-6h-11L5 16zM7 19v.01M17 19v.01' },
  { key: 'gadget', label: 'Gadget', path: 'M5 5h14v10H5zM2 19h20' },
  { key: 'education', label: 'Education', path: 'M2 9l10-5 10 5-10 5-10-5zM6 11v5c3 2 9 2 12 0v-5' },
  { key: 'health', label: 'Health', path: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z' },
  { key: 'gift', label: 'Gift', path: 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13' },
  { key: 'celebration', label: 'Celebration', path: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18' }
];

export function goalIconPath(icon: GoalIcon | null): string {
  return (GOAL_ICONS.find(i => i.key === icon) ?? GOAL_ICONS[0]).path;
}

const STATE_WORDS: Record<GoalState, string> = {
  'on-track': 'On track',
  behind: 'Behind',
  'date-passed': 'Date passed',
  reached: 'Reached',
  paused: 'Paused',
  completed: 'Completed'
};

export function goalStateWord(state: GoalState): string {
  return STATE_WORDS[state];
}

/** "31 Mar 2027", always with the year: target dates are often next year. */
export function goalDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
}

/** "4 months" / "1 month" / "this month". */
export function monthsText(months: number): string {
  if (months <= 1) return months === 1 ? '1 month' : 'date passed';
  return `${months} months`;
}
