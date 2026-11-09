import { HttpClient, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** Everything the API can hand back when a call fails. */
export interface ApiError {
  status: number;
  message: string;
}

/**
 * Thin wrapper over HttpClient: fixes the base path, sends the session cookie,
 * and turns error responses into a predictable { status, message } shape so
 * components do not each have to dig through HttpErrorResponse.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  /**
   * Fires when a request is refused because the session is gone: expired,
   * revoked from another device, or the account deleted. AuthService listens
   * and sends the person to sign in, rather than every page showing its own
   * "Not signed in" error with nothing to do about it.
   */
  readonly sessionExpired$ = new Subject<void>();

  /** A 401 from these is the answer itself, not a lost session. */
  private static readonly OWN_401 = ['/auth/login', '/auth/register', '/auth/me'];

  private handle = (path: string) => (response: HttpErrorResponse) => {
    if (response.status === 401 && !ApiService.OWN_401.includes(path)) {
      this.sessionExpired$.next();
    }

    return toApiError(response);
  };

  /**
   * Sends a file's bytes as the body, reporting upload progress as it goes.
   * The events include HttpEventType.UploadProgress and, at the end, the
   * Response; failures arrive as the usual { status, message }.
   */
  upload<T>(path: string, body: Blob, headers: Record<string, string>): Observable<HttpEvent<T>> {
    return this.http
      .post<T>(this.base + path, body, {
        withCredentials: true,
        reportProgress: true,
        observe: 'events',
        headers: { 'Content-Type': 'application/octet-stream', ...headers }
      })
      .pipe(catchError(this.handle(path)));
  }

  get<T>(path: string): Observable<T> {
    return this.http
      .get<T>(this.base + path, { withCredentials: true })
      .pipe(catchError(this.handle(path)));
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .post<T>(this.base + path, body ?? {}, { withCredentials: true })
      .pipe(catchError(this.handle(path)));
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .put<T>(this.base + path, body ?? {}, { withCredentials: true })
      .pipe(catchError(this.handle(path)));
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .patch<T>(this.base + path, body ?? {}, { withCredentials: true })
      .pipe(catchError(this.handle(path)));
  }

  /**
   * @param body sent as the request body, which DELETE allows. Needed where the
   *   server asks for a password before destroying something.
   */
  delete<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .delete<T>(this.base + path, { withCredentials: true, body })
      .pipe(catchError(this.handle(path)));
  }
}

/** A failed connection, or a gateway with nothing behind it. */
const GATEWAY_STATUSES = new Set([0, 502, 503, 504]);

/**
 * Worded for whoever is actually reading it. The old text told them to run
 * `npm run dev`, which is an instruction for this machine, not for someone
 * using the deployed site — and naming the internals of a service that is down
 * tells a stranger more about it than it tells the user.
 */
const UNREACHABLE_MESSAGE =
  'Cannot reach the server. Check your connection and try again in a moment.';

/**
 * The API answers every failure with a JSON `error` field, including its own
 * 500s. A response carrying no such field therefore did not come from the API
 * at all — it came from whatever sits in front of it. The Angular dev-server
 * proxy in particular returns a bodyless 500 when nothing is listening, which
 * would otherwise be reported as a generic fault.
 */
function isUnreachable(response: HttpErrorResponse, hasServerMessage: boolean): boolean {
  if (GATEWAY_STATUSES.has(response.status)) {
    return true;
  }

  return response.status === 500 && !hasServerMessage;
}

function toApiError(response: HttpErrorResponse): Observable<never> {
  const serverMessage =
    typeof response.error?.error === 'string' ? response.error.error : null;

  const message =
    serverMessage ||
    (isUnreachable(response, Boolean(serverMessage))
      ? UNREACHABLE_MESSAGE
      : 'Something went wrong.');

  const error: ApiError = { status: response.status, message };

  return throwError(() => error);
}
