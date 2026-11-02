import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { balanceGuard } from './balance.guard';
import { AuthService } from './auth.service';
import { DEFAULT_SETTINGS, Settings } from './shared/models';

describe('balanceGuard', () => {
  let http: HttpTestingController;
  let router: Router;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => http.verify());

  function signIn(loginType: 'user' | 'admin') {
    auth.login('ada@example.com', 'pw').subscribe();
    http.expectOne('/api/auth/login').flush({
      user: { id: 'u1', name: 'Ada', email: 'ada@example.com', hasAdminPassword: true },
      loginType
    });
  }

  function run(settings: Partial<Settings>) {
    const result = TestBed.runInInjectionContext(() =>
      balanceGuard({} as never, {} as never)
    );

    const decision = firstValueFrom(isObservable(result) ? result : of(result));

    http.expectOne('/api/settings').flush({ ...DEFAULT_SETTINGS, ...settings });

    return decision;
  }

  it('lets a permitted user open the page', async () => {
    signIn('user');

    expect(await run({ balanceUserAccess: true })).toBeTrue();
  });

  it('sends a blocked user home instead', async () => {
    signIn('user');

    const result = await run({ balanceUserAccess: false });

    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toContain('/home');
  });

  // The toggle describes the normal user, so an admin session is never blocked.
  it('always lets an admin session through', async () => {
    signIn('admin');

    expect(await run({ balanceUserAccess: false })).toBeTrue();
  });
});
