import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { ApiService } from './shared/api.service';
import { LoginType, Session, SessionUser } from './shared/models';

/**
 * Owns the signed-in session.
 *
 * The session itself is an httpOnly cookie the server sets, so nothing here
 * can read or forge it; this class only caches what /auth/me reported so the
 * UI can render without a round trip on every check.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);

  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);

  readonly session$ = this.sessionSubject.asObservable();

  readonly user$: Observable<SessionUser | null> = this.session$.pipe(
    map(session => session?.user ?? null)
  );

  /** In-flight /auth/me, shared so concurrent guards make one request. */
  private pendingLookup: Observable<Session | null> | null = null;

  private readonly router = inject(Router, { optional: true });

  constructor() {
    /*
     * The cookie can stop working while the page is open: it expires, a
     * password change elsewhere revokes it, or the account is deleted. The
     * cached session would otherwise keep every guard saying yes while each
     * request failed, so it is dropped and the person sent to sign in.
     */
    this.api.sessionExpired$.subscribe(() => {
      if (!this.sessionSubject.value) {
        return;
      }

      this.sessionSubject.next(null);
      this.pendingLookup = null;

      this.router?.navigate(['/login'], { queryParams: { message: 'expired' } });
    });
  }

  /** Cached answer; null until the first ensureSession() resolves. */
  get session(): Session | null {
    return this.sessionSubject.value;
  }

  get loginType(): LoginType {
    return this.sessionSubject.value?.loginType ?? 'user';
  }

  get isAdmin(): boolean {
    return this.loginType === 'admin';
  }

  /** Synchronous best guess, valid only after ensureSession() has run once. */
  isAuthenticated(): boolean {
    return this.sessionSubject.value !== null;
  }

  /**
   * Resolves the session, asking the server the first time and reusing the
   * cached value afterwards. A 401 resolves to null rather than erroring.
   */
  ensureSession(): Observable<Session | null> {
    if (this.sessionSubject.value) {
      return of(this.sessionSubject.value);
    }

    if (!this.pendingLookup) {
      this.pendingLookup = this.api.get<Session>('/auth/me').pipe(
        catchError(() => of(null)),
        tap(session => {
          this.sessionSubject.next(session);
          this.pendingLookup = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }

    return this.pendingLookup;
  }

  /** Forces a re-read, e.g. after the full-access password changes. */
  refreshSession(): Observable<Session | null> {
    this.sessionSubject.next(null);
    this.pendingLookup = null;
    return this.ensureSession();
  }

  login(email: string, password: string): Observable<Session> {
    return this.api
      .post<Session>('/auth/login', { email, password })
      .pipe(tap(session => this.sessionSubject.next(session)));
  }

  register(payload: {
    name: string;
    email: string;
    password: string;
    adminPassword?: string;
  }): Observable<Session> {
    return this.api
      .post<Session>('/auth/register', payload)
      .pipe(tap(session => this.sessionSubject.next(session)));
  }

  logout(): Observable<void> {
    return this.api.post<void>('/auth/logout').pipe(
      tap(() => {
        this.sessionSubject.next(null);
        this.pendingLookup = null;
      })
    );
  }

  /**
   * Both of these change hasAdminPassword, so re-read the session after.
   *
   * @param currentAdminPassword required by the server only when replacing an
   *   existing full-access password from a normal session; creating the first one, or
   *   changing it while signed in as admin, needs nothing.
   */
  setAdminPassword(
    adminPassword: string,
    currentAdminPassword?: string
  ): Observable<Session | null> {
    return this.api
      .put('/auth/admin-password', { adminPassword, currentAdminPassword })
      .pipe(switchMap(() => this.refreshSession()));
  }

  removeAdminPassword(adminPassword: string): Observable<Session | null> {
    return this.api
      .post('/auth/admin-password/remove', { adminPassword })
      .pipe(switchMap(() => this.refreshSession()));
  }
}
