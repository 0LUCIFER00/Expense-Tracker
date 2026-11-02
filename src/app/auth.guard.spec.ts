import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { authGuard } from './auth.guard';
import { Session } from './shared/models';

const SESSION: Session = {
  user: {
    id: 'u1',
    name: 'Ada',
    email: 'ada@example.com',
    hasAdminPassword: false,
    createdAt: '2026-01-15T09:00:00.000Z'
  },
  loginType: 'user'
};

describe('authGuard', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  function run() {
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, {} as never)
    );

    return firstValueFrom(isObservable(result) ? result : of(result));
  }

  it('lets a signed-in visitor through', async () => {
    const decision = run();

    http.expectOne('/api/auth/me').flush(SESSION);

    expect(await decision).toBeTrue();
  });

  it('redirects an anonymous visitor to login with a message', async () => {
    const decision = run();

    http.expectOne('/api/auth/me').flush(
      { error: 'Not signed in' },
      { status: 401, statusText: 'Unauthorized' }
    );

    const result = await decision;

    expect(result instanceof UrlTree).toBeTrue();

    const tree = result as UrlTree;
    expect(router.serializeUrl(tree)).toContain('/login');
    expect(tree.queryParams['message']).toBe('User should login to access page');
  });

  it('asks the server rather than trusting anything the page can set', async () => {
    // A flag in browser storage must not be able to satisfy the guard.
    localStorage.setItem('isLoggedIn', 'true');

    const decision = run();

    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect((await decision) instanceof UrlTree).toBeTrue();

    localStorage.clear();
  });

  it('reuses the cached session for a second navigation', async () => {
    const first = run();
    http.expectOne('/api/auth/me').flush(SESSION);
    expect(await first).toBeTrue();

    const second = run();
    http.expectNone('/api/auth/me');
    expect(await second).toBeTrue();
  });
});
