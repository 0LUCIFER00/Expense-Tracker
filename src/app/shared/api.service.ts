import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
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

  get<T>(path: string): Observable<T> {
    return this.http
      .get<T>(this.base + path, { withCredentials: true })
      .pipe(catchError(toApiError));
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .post<T>(this.base + path, body ?? {}, { withCredentials: true })
      .pipe(catchError(toApiError));
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .put<T>(this.base + path, body ?? {}, { withCredentials: true })
      .pipe(catchError(toApiError));
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .patch<T>(this.base + path, body ?? {}, { withCredentials: true })
      .pipe(catchError(toApiError));
  }

  /**
   * @param body sent as the request body, which DELETE allows. Needed where the
   *   server asks for a password before destroying something.
   */
  delete<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .delete<T>(this.base + path, { withCredentials: true, body })
      .pipe(catchError(toApiError));
  }
}

/** A failed connection, or a gateway with nothing behind it. */
const GATEWAY_STATUSES = new Set([0, 502, 503, 504]);

const UNREACHABLE_MESSAGE = 'Cannot reach the server. Start the API with: npm run dev';

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
