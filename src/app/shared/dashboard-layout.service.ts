import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type DashboardLayout = 'balances' | 'ledger';

const STORAGE_KEY = 'dashboardLayout';

/**
 * Which arrangement the dashboard uses.
 *
 * Like the theme, this is a per-browser preference rather than account data —
 * it changes nothing about what the page can show, only how it is laid out —
 * so it lives in localStorage. Every access is guarded because private windows
 * and blocked site data both make it throw.
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private readonly layoutSubject = new BehaviorSubject<DashboardLayout>(this.readStored());

  readonly layout$ = this.layoutSubject.asObservable();

  get layout(): DashboardLayout {
    return this.layoutSubject.value;
  }

  set(layout: DashboardLayout): void {
    this.layoutSubject.next(layout);

    try {
      localStorage.setItem(STORAGE_KEY, layout);
    } catch {
      // Not persisted this session; the page still switches.
    }
  }

  private readStored(): DashboardLayout {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'ledger' ? 'ledger' : 'balances';
    } catch {
      return 'balances';
    }
  }
}
