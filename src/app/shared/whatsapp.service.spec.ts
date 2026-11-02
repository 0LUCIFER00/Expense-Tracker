import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    service = TestBed.inject(WhatsappService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reports a connected number, masked', () => {
    let status: unknown;
    service.status().subscribe(result => (status = result));

    http.expectOne('/api/whatsapp/link').flush({
      available: true,
      connected: true,
      number: '••••• 3210',
      businessNumber: '919000000000'
    });

    expect(status).toEqual({
      available: true,
      connected: true,
      number: '••••• 3210',
      businessNumber: '919000000000'
    });
  });

  it('reports when the server has no WhatsApp credentials', () => {
    let status: { available: boolean } | undefined;
    service.status().subscribe(result => (status = result));

    http.expectOne('/api/whatsapp/link').flush({
      available: false,
      connected: false,
      number: null,
      businessNumber: null
    });

    expect(status?.available).toBeFalse();
  });

  it('requests a link code with a ready-made chat link', () => {
    let result: { code: string; chatUrl: string | null } | undefined;
    service.requestCode().subscribe(value => (result = value));

    const request = http.expectOne('/api/whatsapp/link/code');
    expect(request.request.method).toBe('POST');

    request.flush({
      code: 'K7M2PQ',
      expiresInMinutes: 15,
      businessNumber: '919000000000',
      chatUrl: 'https://wa.me/919000000000?text=link%20K7M2PQ'
    });

    expect(result?.code).toBe('K7M2PQ');
    expect(result?.chatUrl).toContain('link%20K7M2PQ');
  });

  it('tolerates a server that does not know its own number', () => {
    let result: { chatUrl: string | null } | undefined;
    service.requestCode().subscribe(value => (result = value));

    http.expectOne('/api/whatsapp/link/code').flush({
      code: 'K7M2PQ',
      expiresInMinutes: 15,
      businessNumber: null,
      chatUrl: null
    });

    expect(result?.chatUrl).toBeNull();
  });

  it('surfaces an unconfigured server when asking for a code', done => {
    service.requestCode().subscribe({
      error: error => {
        expect(error.status).toBe(503);
        expect(error.message).toContain('not configured');
        done();
      }
    });

    http.expectOne('/api/whatsapp/link/code').flush(
      { error: 'WhatsApp is not configured on this server.' },
      { status: 503, statusText: 'Service Unavailable' }
    );
  });

  it('disconnects with DELETE', () => {
    service.disconnect().subscribe();

    const request = http.expectOne('/api/whatsapp/link');
    expect(request.request.method).toBe('DELETE');

    request.flush(null);
  });
});
