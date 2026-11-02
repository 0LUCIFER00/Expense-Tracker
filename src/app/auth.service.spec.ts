import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { Session } from './shared/models';

const SESSION: Session = {
  user: {
    id: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    hasAdminPassword: false,
    createdAt: '2026-01-15T09:00:00.000Z'
  },
  loginType: 'user'
};

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('ensureSession', () => {
    it('asks the server once and caches the answer', () => {
      auth.ensureSession().subscribe();
      http.expectOne('/api/auth/me').flush(SESSION);

      auth.ensureSession().subscribe(session => {
        expect(session?.user.name).toBe('Ada Lovelace');
      });

      // No second request: expectNone would fail if one were issued.
      http.expectNone('/api/auth/me');
    });

    it('resolves to null on 401 rather than erroring', done => {
      auth.ensureSession().subscribe({
        next: session => {
          expect(session).toBeNull();
          expect(auth.isAuthenticated()).toBeFalse();
          done();
        },
        error: () => done.fail('should not error')
      });

      http.expectOne('/api/auth/me').flush(
        { error: 'Not signed in' },
        { status: 401, statusText: 'Unauthorized' }
      );
    });

    it('shares one request between concurrent callers', () => {
      auth.ensureSession().subscribe();
      auth.ensureSession().subscribe();

      // Both guards resolve from a single /auth/me.
      http.expectOne('/api/auth/me').flush(SESSION);
    });

    it('re-reads after refreshSession', () => {
      auth.ensureSession().subscribe();
      http.expectOne('/api/auth/me').flush(SESSION);

      auth.refreshSession().subscribe();
      http.expectOne('/api/auth/me').flush({
        ...SESSION,
        user: { ...SESSION.user, hasAdminPassword: true, createdAt: '2026-01-15T09:00:00.000Z' }
      });

      expect(auth.session?.user.hasAdminPassword).toBeTrue();
    });
  });

  describe('login', () => {
    it('caches the session it returns', () => {
      auth.login('ada@example.com', 'secret123').subscribe();

      const request = http.expectOne('/api/auth/login');
      expect(request.request.body).toEqual({
        email: 'ada@example.com',
        password: 'secret123'
      });

      request.flush(SESSION);

      expect(auth.isAuthenticated()).toBeTrue();
      expect(auth.loginType).toBe('user');
      expect(auth.isAdmin).toBeFalse();
    });

    it('records an admin sign-in', () => {
      auth.login('ada@example.com', 'admin123').subscribe();
      http.expectOne('/api/auth/login').flush({ ...SESSION, loginType: 'admin' });

      expect(auth.isAdmin).toBeTrue();
    });

    it('leaves the session empty when rejected', done => {
      auth.login('ada@example.com', 'wrong').subscribe({
        error: error => {
          expect(error.message).toBe('Invalid email or password');
          expect(auth.isAuthenticated()).toBeFalse();
          done();
        }
      });

      http.expectOne('/api/auth/login').flush(
        { error: 'Invalid email or password' },
        { status: 401, statusText: 'Unauthorized' }
      );
    });

    it('defaults loginType to user before anyone signs in', () => {
      expect(auth.loginType).toBe('user');
      expect(auth.session).toBeNull();
    });
  });

  describe('register', () => {
    it('forwards the account details and caches the session', () => {
      auth
        .register({ name: 'Ada', email: 'ada@example.com', password: 'secret123' })
        .subscribe();

      const request = http.expectOne('/api/auth/register');
      expect(request.request.body.name).toBe('Ada');

      request.flush(SESSION);

      expect(auth.isAuthenticated()).toBeTrue();
    });

    it('surfaces a duplicate email', done => {
      auth
        .register({ name: 'Ada', email: 'ada@example.com', password: 'secret123' })
        .subscribe({
          error: error => {
            expect(error.status).toBe(409);
            done();
          }
        });

      http.expectOne('/api/auth/register').flush(
        { error: 'An account with this email already exists.' },
        { status: 409, statusText: 'Conflict' }
      );
    });
  });

  it('clears the cached session on logout', () => {
    auth.login('ada@example.com', 'secret123').subscribe();
    http.expectOne('/api/auth/login').flush(SESSION);

    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null);

    expect(auth.isAuthenticated()).toBeFalse();

    // The next check must go back to the server rather than reuse the old value.
    auth.ensureSession().subscribe();
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
  });

  describe('admin password', () => {
    it('re-reads the session after setting one', () => {
      auth.setAdminPassword('admin123').subscribe();

      const request = http.expectOne('/api/auth/admin-password');
      expect(request.request.method).toBe('PUT');
      request.flush({ hasAdminPassword: true, createdAt: '2026-01-15T09:00:00.000Z' });

      http.expectOne('/api/auth/me').flush({
        ...SESSION,
        user: { ...SESSION.user, hasAdminPassword: true, createdAt: '2026-01-15T09:00:00.000Z' }
      });

      expect(auth.session?.user.hasAdminPassword).toBeTrue();
    });

    it('surfaces a wrong password when removing', done => {
      auth.removeAdminPassword('nope').subscribe({
        error: error => {
          expect(error.message).toBe('Invalid admin password');
          done();
        }
      });

      http.expectOne('/api/auth/admin-password/remove').flush(
        { error: 'Invalid admin password' },
        { status: 403, statusText: 'Forbidden' }
      );
    });
  });
});
