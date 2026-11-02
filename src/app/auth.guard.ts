import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from './auth.service';

/**
 * Asks the server whether the cookie is still a valid session, rather than
 * trusting a flag the page could set itself. The answer is cached by
 * AuthService, so this costs one request per page load at most.
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureSession().pipe(
    map(session => {
      if (session) {
        return true;
      }

      return router.createUrlTree(['/login'], {
        queryParams: {
          message: 'User should login to access page',
          time: new Date().getTime()
        }
      });
    })
  );
};
