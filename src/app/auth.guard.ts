import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: {
      message: 'User should login to access page',
      time: new Date().getTime()
    }
  });

  return router.createUrlTree(['/login'], {
  queryParams: {
    message: 'User should login to access page',
    time: new Date().getTime()
  }
});
};