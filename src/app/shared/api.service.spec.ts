import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { ApiError, ApiService } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('prefixes every path with /api', () => {
    api.get('/expenses').subscribe();

    http.expectOne('/api/expenses').flush([]);
  });

  it('sends credentials so the session cookie travels', () => {
    api.get('/auth/me').subscribe();

    const request = http.expectOne('/api/auth/me');

    expect(request.request.withCredentials).toBeTrue();
    request.flush({});
  });

  it('posts an empty object when no body is given', () => {
    api.post('/auth/logout').subscribe();

    const request = http.expectOne('/api/auth/logout');

    expect(request.request.body).toEqual({});
    request.flush(null);
  });

  it('unwraps the server error message', done => {
    api.get('/expenses').subscribe({
      error: (error: ApiError) => {
        expect(error.status).toBe(409);
        expect(error.message).toBe('Insufficient balance.');
        done();
      }
    });

    http.expectOne('/api/expenses').flush(
      { error: 'Insufficient balance.' },
      { status: 409, statusText: 'Conflict' }
    );
  });

  it('reports an unreachable API distinctly from a server error', done => {
    api.get('/expenses').subscribe({
      error: (error: ApiError) => {
        expect(error.status).toBe(0);
        expect(error.message).toContain('Cannot reach the server');
        done();
      }
    });

    http.expectOne('/api/expenses').error(new ProgressEvent('error'), { status: 0 });
  });

  it('treats a bodyless 500 as the API being down, not a server fault', done => {
    // The Angular dev-server proxy answers like this when nothing is listening
    // on the API port; the API itself always sends an { error } field.
    api.get('/expenses').subscribe({
      error: (error: ApiError) => {
        expect(error.message).toContain('Cannot reach the server');
        done();
      }
    });

    http.expectOne('/api/expenses').flush(null, { status: 500, statusText: 'Server Error' });
  });

  it('still reports a genuine 500 from the API as a server fault', done => {
    api.get('/expenses').subscribe({
      error: (error: ApiError) => {
        expect(error.message).toBe('Something went wrong.');
        done();
      }
    });

    http.expectOne('/api/expenses').flush(
      { error: 'Something went wrong.' },
      { status: 500, statusText: 'Server Error' }
    );
  });

  it('reports a gateway status as unreachable', done => {
    api.get('/expenses').subscribe({
      error: (error: ApiError) => {
        expect(error.message).toContain('Cannot reach the server');
        done();
      }
    });

    http.expectOne('/api/expenses').flush(null, { status: 504, statusText: 'Gateway Timeout' });
  });

  it('issues the right verbs', () => {
    api.put('/balances/1', { balance: 5 }).subscribe();
    expect(http.expectOne('/api/balances/1').request.method).toBe('PUT');

    api.patch('/settings', { viewPermissionUser: false }).subscribe();
    expect(http.expectOne('/api/settings').request.method).toBe('PATCH');

    api.delete('/expenses/1').subscribe();
    expect(http.expectOne('/api/expenses/1').request.method).toBe('DELETE');

    http.verify();
  });
});
