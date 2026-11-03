import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { SettingsService } from './shared/settings.service';

/**
 * Keeps the Money Management page off limits when balances are hidden.
 *
 * The header already drops the link, but a typed URL would otherwise still
 * open the page. The API withholds the amounts and refuses the writes either
 * way; this just means a blocked user sees the home page instead of a form
 * full of blanks.
 *
 * Runs after authGuard, so there is a session by the time it is reached.
 */
export const balanceGuard: CanActivateFn = () => {
  const settingsService = inject(SettingsService);
  const router = inject(Router);

  return settingsService.load().pipe(
    map(() => {
      if (settingsService.canSeeBalances) {
        return true;
      }

      return router.createUrlTree(['/home']);
    })
  );
};
