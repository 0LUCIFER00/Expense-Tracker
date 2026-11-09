import { ComponentFixture, TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { WhatsappService, WhatsappLinkStatus } from '../shared/whatsapp.service';
import { ToastService } from '../shared/toast.service';
import { DEFAULT_SETTINGS, Session } from '../shared/models';

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

describe('SettingsComponent — WhatsApp section', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let component: SettingsComponent;
  let whatsapp: jasmine.SpyObj<WhatsappService>;

  function setUp(
    status: WhatsappLinkStatus,
    loginType: 'user' | 'admin' = 'user',
    hasAdminPassword = false
  ) {
    const auth = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['ensureSession', 'setAdminPassword', 'removeAdminPassword'],
      { loginType }
    );
    auth.ensureSession.and.returnValue(
      of({ ...SESSION, loginType, user: { ...SESSION.user, hasAdminPassword } })
    );

    const settings = jasmine.createSpyObj<SettingsService>('SettingsService', ['load', 'update']);
    settings.load.and.returnValue(of({ ...DEFAULT_SETTINGS }));
    settings.update.and.returnValue(of({ ...DEFAULT_SETTINGS }));

    whatsapp = jasmine.createSpyObj<WhatsappService>('WhatsappService', [
      'status',
      'requestCode',
      'disconnect'
    ]);
    whatsapp.status.and.returnValue(of(status));
    whatsapp.requestCode.and.returnValue(
      of({
        code: 'K7M2PQ',
        expiresInMinutes: 15,
        businessNumber: '919000000000',
        chatUrl: 'https://wa.me/919000000000?text=link%20K7M2PQ'
      })
    );
    whatsapp.disconnect.and.returnValue(of(undefined));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: SettingsService, useValue: settings },
        { provide: WhatsappService, useValue: whatsapp }
      ]
    });

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('says so when the server has no WhatsApp credentials', () => {
    setUp({ available: false, connected: false, number: null, businessNumber: null });

    expect(text()).toContain('no WhatsApp credentials');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.et-btn-primary')
    ).toBeNull();
  });

  it('offers to connect when available but not linked', () => {
    setUp({ available: true, connected: false, number: null, businessNumber: '919000000000' });

    const button = (fixture.nativeElement as HTMLElement).querySelector('.et-btn-primary');

    expect(button?.textContent).toContain('Connect WhatsApp');
    expect(text()).not.toContain('Disconnect');
  });

  it('shows the link code to send, and keeps it out of view until asked', () => {
    setUp({ available: true, connected: false, number: null, businessNumber: '919000000000' });

    expect((fixture.nativeElement as HTMLElement).querySelector('.link-code')).toBeNull();

    component.onConnectWhatsapp();
    fixture.detectChanges();

    expect(whatsapp.requestCode).toHaveBeenCalled();
    expect(text()).toContain('link K7M2PQ');
    expect(text()).toContain('15 minutes');
  });

  it('shows the masked number once connected, and no code', () => {
    setUp({ available: true, connected: true, number: '••••• 3210', businessNumber: '919000000000' });

    expect(text()).toContain('••••• 3210');
    expect(text()).toContain('Connected');
    expect((fixture.nativeElement as HTMLElement).querySelector('.link-code')).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.et-btn-danger')?.textContent
    ).toContain('Disconnect');
  });

  it('disconnects and re-reads the status', () => {
    setUp({ available: true, connected: true, number: '••••• 3210', businessNumber: '919000000000' });

    whatsapp.status.calls.reset();
    whatsapp.status.and.returnValue(of({ available: true, connected: false, number: null, businessNumber: '919000000000' }));

    component.onDisconnectWhatsapp();
    fixture.detectChanges();

    expect(whatsapp.disconnect).toHaveBeenCalled();
    expect(whatsapp.status).toHaveBeenCalled();
    expect(component.whatsappStatus?.connected).toBeFalse();
  });

  it('surfaces a failure to issue a code', async () => {
    setUp({ available: true, connected: false, number: null, businessNumber: '919000000000' });

    whatsapp.requestCode.and.returnValue(
      throwError(() => ({ status: 503, message: 'WhatsApp is not configured on this server.' }))
    );

    component.onConnectWhatsapp();
    fixture.detectChanges();

    expect(component.whatsappBusy).toBeFalse();

    const toast = TestBed.inject(ToastService);
    const shown = await firstValueFrom(toast.toasts$);

    expect(shown.length).toBe(1);
    expect(shown[0].kind).toBe('error');
    expect(shown[0].text).toContain('not configured');
  });

  it('clears a stale code if the number turns out to be connected', () => {
    setUp({ available: true, connected: false, number: null, businessNumber: '919000000000' });

    component.onConnectWhatsapp();
    expect(component.whatsappCode).toBe('K7M2PQ');

    whatsapp.status.and.returnValue(of({ available: true, connected: true, number: '••••• 3210', businessNumber: '919000000000' }));
    component.onRefreshWhatsapp();
    fixture.detectChanges();

    expect(component.whatsappCode).toBe('');
    expect(text()).toContain('••••• 3210');
  });
});


describe('SettingsComponent — who may edit permissions', () => {
  let fixture: ComponentFixture<SettingsComponent>;

  function build(loginType: 'user' | 'admin', hasAdminPassword: boolean) {
    const auth = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['ensureSession', 'setAdminPassword', 'removeAdminPassword'],
      { loginType }
    );
    auth.ensureSession.and.returnValue(
      of({
        user: { ...SESSION.user, hasAdminPassword },
        loginType
      })
    );

    const settings = jasmine.createSpyObj<SettingsService>('SettingsService', [
      'load',
      'update',
      'reset'
    ]);
    settings.load.and.returnValue(of({ ...DEFAULT_SETTINGS }));
    settings.update.and.returnValue(of({ ...DEFAULT_SETTINGS }));

    const whatsapp = jasmine.createSpyObj<WhatsappService>('WhatsappService', [
      'status',
      'requestCode',
      'disconnect'
    ]);
    whatsapp.status.and.returnValue(
      of({ available: false, connected: false, number: null, businessNumber: null })
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: SettingsService, useValue: settings },
        { provide: WhatsappService, useValue: whatsapp }
      ]
    });

    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('hides the permission matrix from a normal user', () => {
    build('user', true);

    expect(host().querySelectorAll('.settings-row').length).toBe(0);
    expect(host().querySelector('.matrix-head')).toBeNull();
  });

  it('tells a normal user with a full-access password how to get in', () => {
    build('user', true);

    expect(host().textContent).toContain('full-access password to change them');
  });

  it('tells a user with no full-access password to create one first', () => {
    build('user', false);

    expect(host().textContent).toContain('Create full access');
    expect(host().querySelectorAll('.settings-row').length).toBe(0);
  });

  it('shows the full matrix to an admin session', () => {
    build('admin', true);

    // Seven permissions, plus Manage budgets, Manage recurring and Manage savings goals.
    expect(host().querySelectorAll('.settings-row').length).toBe(10);
    expect(host().querySelectorAll('.setting-toggle input').length).toBe(10);
    expect(host().textContent).toContain('Manage budgets');
    expect(host().textContent).toContain('Manage recurring');
    expect(host().textContent).toContain('Manage savings goals');
    expect(host().querySelector('.matrix-head')).not.toBeNull();
    expect(host().querySelector('.permissions-note')).toBeNull();
  });

  it('always offers the create-admin toggle, whichever identity is signed in', () => {
    build('user', false);
    expect(host().querySelector('.admin-row input')).not.toBeNull();

    build('admin', true);
    expect(host().querySelector('.admin-row input')).not.toBeNull();
  });
});
