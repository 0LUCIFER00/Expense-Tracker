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
    // Every permission is granted. Budget alerts and recurring reminders on
    // WhatsApp are preferences, not permissions, and start off: nothing extra
    // is sent unless chosen.
    const { whatsappBudgetAlerts, whatsappRecurringReminders, ...permissions } = settings.settings;

    expect(Object.values(permissions).every(Boolean)).toBeTrue();
    expect(whatsappBudgetAlerts).toBeFalse();
    expect(whatsappRecurringReminders).toBeFalse();
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
    const nothingGranted = {
      balanceUserAccess: false,
      expenseUserAccess: false,
      updatePermissionUser: false,
      viewPermissionUser: false,
      removePermissionUser: false
    };

    it('applies the flags to a user session', () => {
      signIn('user');
      loadWith(allGranted(nothingGranted));

      expect(settings.canSeeBalances).toBeFalse();
      expect(settings.canUpdateBalance).toBeFalse();
      expect(settings.canBackdate).toBeFalse();
      expect(settings.canViewSource).toBeFalse();
      expect(settings.canRemove).toBeFalse();
    });

    // The flags describe the normal user; the full-access password is the owner's
    // own key, so an admin keeps everything whatever they are set to.
    it('ignores the flags for an admin session', () => {
      signIn('admin');
      loadWith(allGranted(nothingGranted));

      expect(settings.canSeeBalances).toBeTrue();
      expect(settings.canUpdateBalance).toBeTrue();
      expect(settings.canBackdate).toBeTrue();
      expect(settings.canViewSource).toBeTrue();
      expect(settings.canRemove).toBeTrue();
    });
  });

  describe('the two switches under seeing balances', () => {
    it('lets Add Money be reached without balances being visible', () => {
      signIn('user');
      loadWith(allGranted({ balanceUserAccess: false, addMoneyUserAccess: true }));

      expect(settings.canSeeBalances).toBeFalse();
      expect(settings.canAddMoney).toBeTrue();
    });

    it('hides Add Money on its own switch', () => {
      signIn('user');
      loadWith(allGranted({ addMoneyUserAccess: false }));

      expect(settings.canSeeBalances).toBeTrue();
      expect(settings.canAddMoney).toBeFalse();
    });

    it('gives an admin both whatever the flags say', () => {
      signIn('admin');
      loadWith(allGranted({ balanceUserAccess: false, addMoneyUserAccess: false }));

      expect(settings.canSeeBalances).toBeTrue();
      expect(settings.canAddMoney).toBeTrue();
    });
  });

  // Matches the API: retyping a balance moves money as surely as spending it.
  describe('managing balances on Cash & Accounts', () => {
    it('needs both seeing balances and debiting from an account', () => {
      signIn('user');
      loadWith(allGranted({ expenseUserAccess: false }));

      expect(settings.canSeeBalances).toBeTrue();
      expect(settings.canManageBalances).toBeFalse();
    });

    it('is allowed when both are on', () => {
      signIn('user');
      loadWith(allGranted());

      expect(settings.canManageBalances).toBeTrue();
    });

    it('is always allowed with full access', () => {
      signIn('admin');
      loadWith(allGranted({ balanceUserAccess: false, expenseUserAccess: false }));

      expect(settings.canManageBalances).toBeTrue();
    });
  });

  describe('addMoneyAccess$', () => {
    it('follows the toggle for a user session', () => {
      signIn('user');

      const seen: boolean[] = [];
      settings.addMoneyAccess$.subscribe(value => seen.push(value));

      loadWith(allGranted({ addMoneyUserAccess: false }));

      expect(seen[seen.length - 1]).toBeFalse();
    });

    it('stays on for an admin session with the toggle off', () => {
      signIn('admin');

      const seen: boolean[] = [];
      settings.addMoneyAccess$.subscribe(value => seen.push(value));

      loadWith(allGranted({ addMoneyUserAccess: false }));

      expect(seen[seen.length - 1]).toBeTrue();
    });
  });

  describe('balanceAccess$', () => {
    it('follows the toggle for a user session', () => {
      signIn('user');

      const seen: boolean[] = [];
      settings.balanceAccess$.subscribe(value => seen.push(value));

      loadWith(allGranted({ balanceUserAccess: false }));

      expect(seen[seen.length - 1]).toBeFalse();
    });

    it('stays on for an admin session with the toggle off', () => {
      signIn('admin');

      const seen: boolean[] = [];
      settings.balanceAccess$.subscribe(value => seen.push(value));

      loadWith(allGranted({ balanceUserAccess: false }));

      expect(seen[seen.length - 1]).toBeTrue();
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
