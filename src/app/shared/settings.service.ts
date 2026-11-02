import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from '../auth.service';
import { DEFAULT_SETTINGS, Settings } from './models';

/**
 * The ten permission flags, plus the "what may the signed-in identity do"
 * questions derived from them. The server enforces all of this as well; the
 * answers here only decide what the UI bothers to render.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly settingsSubject = new BehaviorSubject<Settings>({ ...DEFAULT_SETTINGS });

  readonly settings$ = this.settingsSubject.asObservable();

  /** Drives the Balance Management link in the header. */
  readonly balanceAccess$: Observable<boolean> = this.settings$.pipe(
    map(settings => this.pick(settings, 'balanceAdminAccess', 'balanceUserAccess'))
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

  private pick(settings: Settings, adminKey: keyof Settings, userKey: keyof Settings): boolean {
    return this.auth.isAdmin ? settings[adminKey] : settings[userKey];
  }

  get canUpdateBalance(): boolean {
    return this.pick(this.settings, 'expenseAdminAccess', 'expenseUserAccess');
  }

  /** May add an entry dated in the past or future without admin approval. */
  get canBackdate(): boolean {
    return this.pick(this.settings, 'updatePermissionAdmin', 'updatePermissionUser');
  }

  get canViewSource(): boolean {
    return this.pick(this.settings, 'viewPermissionAdmin', 'viewPermissionUser');
  }

  get canRemove(): boolean {
    return this.pick(this.settings, 'removePermissionAdmin', 'removePermissionUser');
  }
}
