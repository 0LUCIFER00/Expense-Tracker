import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from '../auth.service';
import { DEFAULT_SETTINGS, Settings } from './models';

/**
 * The normal user's permission flags, plus the "what may the signed-in identity
 * do" questions derived from them. The server enforces all of this as well; the
 * answers here only decide what the UI bothers to render.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly settingsSubject = new BehaviorSubject<Settings>({ ...DEFAULT_SETTINGS });

  readonly settings$ = this.settingsSubject.asObservable();

  /** Drives the Money Management link in the header. */
  readonly balanceAccess$: Observable<boolean> = this.settings$.pipe(
    map(settings => this.auth.isAdmin || settings.balanceUserAccess)
  );

  /** Drives the Add Money link beside it. */
  readonly addMoneyAccess$: Observable<boolean> = this.settings$.pipe(
    map(settings => this.auth.isAdmin || settings.addMoneyUserAccess)
  );

  private loaded = false;

  get settings(): Settings {
    return this.settingsSubject.value;
  }

  load(force = false): Observable<Settings> {
    if (this.loaded && !force) {
      return of(this.settingsSubject.value);
    }

    return this.api.get<Settings>('/settings').pipe(
      tap(settings => {
        this.loaded = true;
        this.settingsSubject.next(settings);
      })
    );
  }

  /** Sends only the flags that changed. */
  update(changes: Partial<Settings>): Observable<Settings> {
    return this.api
      .patch<Settings>('/settings', changes)
      .pipe(tap(settings => this.settingsSubject.next(settings)));
  }

  reset(): void {
    this.loaded = false;
    this.settingsSubject.next({ ...DEFAULT_SETTINGS });
  }

  /** An admin always has everything; a normal user has what the flags allow. */
  private allows(key: keyof Settings): boolean {
    return this.auth.isAdmin || this.settings[key];
  }

  /** Whether any account balance may be shown on screen. */
  get canSeeBalances(): boolean {
    return this.allows('balanceUserAccess');
  }

  /**
   * Whether the Add Money page is reachable. Separate from seeing balances:
   * someone may be trusted to put money in without being shown what is there,
   * and the amounts on that page follow canSeeBalances on their own.
   */
  get canAddMoney(): boolean {
    return this.allows('addMoneyUserAccess');
  }

  get canUpdateBalance(): boolean {
    return this.allows('expenseUserAccess');
  }

  /** May create, change and remove budgets. Seeing them needs nothing. */
  get canManageBudgets(): boolean {
    return this.allows('budgetUserAccess');
  }

  /** May create, change, pause and delete recurring schedules. Seeing them needs nothing. */
  get canManageRecurring(): boolean {
    return this.allows('recurringUserAccess');
  }

  /**
   * May create, retype or delete an account on Cash & Accounts. Needs both
   * seeing the amounts and "Debit from an account", as the API does: retyping a
   * balance moves money as surely as spending from it.
   */
  get canManageBalances(): boolean {
    return this.canSeeBalances && this.canUpdateBalance;
  }

  /** May add an entry dated in the past or future without admin approval. */
  get canBackdate(): boolean {
    return this.allows('updatePermissionUser');
  }

  get canViewSource(): boolean {
    return this.allows('viewPermissionUser');
  }

  get canRemove(): boolean {
    return this.allows('removePermissionUser');
  }
}
