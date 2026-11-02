import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { SettingsService } from './settings.service';
import { AuthService } from '../auth.service';
import { DEFAULT_SETTINGS, Settings } from './models';

function allGranted(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('SettingsService', () => {
  let settings: SettingsService;
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    settings = TestBed.inject(SettingsService);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function signIn(loginType: 'user' | 'admin') {
    auth.login('ada@example.com', 'pw').subscribe();
    http.expectOne('/api/auth/login').flush({
      user: { id: 'u1', name: 'Ada', email: 'ada@example.com', hasAdminPassword: true },
      loginType
    });
  }

  function loadWith(values: Settings) {
    settings.load(true).subscribe();
    http.expectOne('/api/settings').flush(values);
  }

  it('starts from the fully-granted defaults', () => {
    expect(Object.values(settings.settings).every(Boolean)).toBeTrue();
  });

  it('caches after the first load', () => {
    loadWith(allGranted());

    settings.load().subscribe();
    http.expectNone('/api/settings');
  });

  it('re-reads when forced', () => {
    loadWith(allGranted());
    loadWith(allGranted({ viewPermissionUser: false }));

    expect(settings.settings.viewPermissionUser).toBeFalse();
  });

  it('sends only the flags being changed', () => {
    settings.update({ removePermissionUser: false }).subscribe();

    const request = http.expectOne('/api/settings');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ removePermissionUser: false });

    request.flush(allGranted({ removePermissionUser: false }));

    expect(settings.settings.removePermissionUser).toBeFalse();
  });

  describe('permissions follow the signed-in identity', () => {
    it('reads the user column for a user session', () => {
      signIn('user');
      loadWith(
        allGranted({
          expenseUserAccess: false,
          updatePermissionUser: false,
          viewPermissionUser: false,
          removePermissionUser: false
        })
      );

      expect(settings.canUpdateBalance).toBeFalse();
      expect(settings.canBackdate).toBeFalse();
      expect(settings.canViewSource).toBeFalse();
      expect(settings.canRemove).toBeFalse();
    });

    it('reads the admin column for an admin session', () => {
      signIn('admin');
      loadWith(
        allGranted({
          // The user column is off; an admin must not be affected by it.
          expenseUserAccess: false,
          updatePermissionUser: false,
          viewPermissionUser: false,
          removePermissionUser: false,
          removePermissionAdmin: false
        })
      );

      expect(settings.canUpdateBalance).toBeTrue();
      expect(settings.canBackdate).toBeTrue();
      expect(settings.canViewSource).toBeTrue();
      expect(settings.canRemove).toBeFalse();
    });
  });

  describe('balanceAccess$', () => {
    it('follows the user toggle for a user session', () => {
      signIn('user');

      const seen: boolean[] = [];
      settings.balanceAccess$.subscribe(value => seen.push(value));

      loadWith(allGranted({ balanceUserAccess: false }));

      expect(seen[seen.length - 1]).toBeFalse();
    });

    it('follows the admin toggle for an admin session', () => {
      signIn('admin');

      const seen: boolean[] = [];
      settings.balanceAccess$.subscribe(value => seen.push(value));

      loadWith(allGranted({ balanceAdminAccess: false, balanceUserAccess: true }));

      expect(seen[seen.length - 1]).toBeFalse();
    });
  });

  it('returns to defaults on reset, and reloads afterwards', () => {
    loadWith(allGranted({ viewPermissionUser: false }));

    settings.reset();

    expect(settings.settings.viewPermissionUser).toBeTrue();

    settings.load().subscribe();
    http.expectOne('/api/settings').flush(allGranted());
  });
});
