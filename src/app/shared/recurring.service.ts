import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  RecurringDraft,
  RecurringFrequency,
  RecurringOutcome,
  RecurringOverview,
  RecurringRun,
  RecurringSchedule,
  RecurringSync
} from './models';

/**
 * Recurring bills and income. The server adds each entry on its due date (a
 * daily job, plus `sync()` whenever the app is opened); nothing here creates an
 * expense or income itself.
 */
@Injectable({ providedIn: 'root' })
export class RecurringService {
  private readonly api = inject(ApiService);

  /** How many occurrences need attention, for the menu's count. */
  private readonly attentionSubject = new BehaviorSubject<number>(0);
  readonly attention$ = this.attentionSubject.asObservable();

  private synced = false;

  overview(): Observable<RecurringOverview> {
    return this.api.get<RecurringOverview>('/recurring').pipe(
      tap(view => this.attentionSubject.next(view.summary.attention))
    );
  }

  /** Adds whatever of this account's has come due. */
  sync(): Observable<RecurringSync> {
    return this.api.post<RecurringSync>('/recurring/sync').pipe(
      tap(result => {
        this.synced = true;
        this.attentionSubject.next(result.attention);
      })
    );
  }

  /** sync() once per app load; later calls answer null. Failures are quiet. */
  syncOnce(): Observable<RecurringSync | null> {
    if (this.synced) {
      return of(null);
    }

    this.synced = true;
    return this.sync().pipe(catchError(() => of(null)));
  }

  /** Forget the last account's state when signing out. */
  reset(): void {
    this.synced = false;
    this.attentionSubject.next(0);
  }

  runs(scheduleId: string): Observable<RecurringRun[]> {
    return this.api.get<RecurringRun[]>(`/recurring/${scheduleId}/runs`);
  }

  create(draft: RecurringDraft): Observable<RecurringSchedule> {
    return this.api.post<RecurringSchedule>('/recurring', draft);
  }

  update(id: string, draft: RecurringDraft): Observable<RecurringSchedule> {
    return this.api.put<RecurringSchedule>(`/recurring/${id}`, draft);
  }

  pause(id: string): Observable<RecurringSchedule> {
    return this.api.post<RecurringSchedule>(`/recurring/${id}/pause`);
  }

  resume(id: string): Observable<RecurringSchedule> {
    return this.api.post<RecurringSchedule>(`/recurring/${id}/resume`);
  }

  /** Deletes the schedule. Entries it already added stay. */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/recurring/${id}`);
  }

  retry(runId: string): Observable<RecurringOutcome> {
    return this.api.post<RecurringOutcome>(`/recurring/runs/${runId}/retry`);
  }

  skip(runId: string): Observable<RecurringRun> {
    return this.api.post<RecurringRun>(`/recurring/runs/${runId}/skip`);
  }
}

/* ---------------- Helpers: plain calendar dates ---------------- */

const DAY_MS = 86_400_000;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function utc(iso: string): Date {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The same rule as the server: counted from the first date, so a schedule on
 * the 31st uses the last day of shorter months and comes back to the 31st.
 */
export function occurrenceDate(
  frequency: RecurringFrequency,
  interval: number,
  anchor: string,
  seq: number
): string {
  if (frequency === 'daily' || frequency === 'weekly') {
    const step = interval * (frequency === 'weekly' ? 7 : 1);
    const date = new Date(utc(anchor).getTime() + seq * step * DAY_MS);
    return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const [y, m, d] = parts(anchor);
  const index = (m - 1) + seq * interval * (frequency === 'yearly' ? 12 : 1);
  const year = y + Math.floor(index / 12);
  const month = (index % 12) + 1;

  return toIso(year, month, Math.min(d, daysInMonth(year, month)));
}

/** The first `count` dates from `anchor`, stopping at `end`. */
export function previewDates(
  frequency: RecurringFrequency,
  interval: number,
  anchor: string,
  end: string | null,
  count = 4
): string[] {
  const dates: string[] = [];

  for (let seq = 0; dates.length < count && seq < count; seq += 1) {
    const date = occurrenceDate(frequency, interval, anchor, seq);

    if (end && date > end) {
      break;
    }

    dates.push(date);
  }

  return dates;
}

/** "Sun 31 Jan", with the year when it isn't this year's. */
export function dateLabel(iso: string | null, today: string): string {
  if (!iso) {
    return '—';
  }

  const sameYear = iso.slice(0, 4) === today.slice(0, 4);

  return utc(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC'
  });
}

/** "Today", "Tomorrow", "in 4 days", "3 days ago". */
export function relativeDay(iso: string, today: string): string {
  const days = daysBetween(today, iso);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';

  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function ordinal(n: number): string {
  const tens = n % 100;

  if (tens >= 11 && tens <= 13) return `${n}th`;

  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

const UNIT: Record<RecurringFrequency, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years']
};

/** "Every day", "Monthly on the 31st", "Every 2 weeks on Friday", "Yearly on 3 Nov". */
export function repeatLabel(frequency: RecurringFrequency, interval: number, anchor: string): string {
  const date = utc(anchor);
  const day = date.getUTCDate();

  if (interval > 1) {
    const every = `Every ${interval} ${UNIT[frequency][1]}`;

    if (frequency === 'weekly') {
      return `${every} on ${date.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}`;
    }

    return frequency === 'monthly' ? `${every} on the ${ordinal(day)}` : every;
  }

  switch (frequency) {
    case 'daily':
      return 'Every day';
    case 'weekly':
      return `Weekly on ${date.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}`;
    case 'monthly':
      return `Monthly on the ${ordinal(day)}`;
    case 'yearly':
      return `Yearly on ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  }
}

export const REMIND_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 0, label: 'On the day' },
  { value: 1, label: '1 day before' },
  { value: 3, label: '3 days before' },
  { value: 7, label: '7 days before' }
];

export function remindLabel(days: number | null): string {
  return REMIND_OPTIONS.find(option => option.value === days)?.label ?? 'Off';
}
