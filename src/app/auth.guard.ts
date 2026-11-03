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

      // A code rather than the sentence itself: the login page keeps the
      // wording, so a crafted link cannot put words in the app's mouth.
      return router.createUrlTree(['/login'], {
        queryParams: { message: 'signed-out' }
      });
    })
  );
};
