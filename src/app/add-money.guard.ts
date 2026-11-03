import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { SettingsService } from './shared/settings.service';

/**
 * Keeps Add Money off limits when it has been switched off.
 *
 * The header already drops the link, but a typed URL would otherwise still
 * open the page. The API refuses the write either way; this just means a
 * blocked user sees the home page instead of a form that cannot submit.
 *
 * Runs after authGuard, so there is a session by the time it is reached.
 */
export const addMoneyGuard: CanActivateFn = () => {
  const settingsService = inject(SettingsService);
  const router = inject(Router);

  return settingsService.load().pipe(
    map(() => (settingsService.canAddMoney ? true : router.createUrlTree(['/home'])))
  );
};
