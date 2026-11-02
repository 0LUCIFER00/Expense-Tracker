import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

/**
 * Light/dark switching.
 *
 * Light is the default and its styling is untouched — dark is added on top via
 * `[data-theme="dark"]` on <html>, which every component stylesheet overrides
 * from. The choice is a per-browser preference rather than account data, so it
 * lives in localStorage; every access is guarded because private windows and
 * blocked site data both make it throw.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly themeSubject = new BehaviorSubject<Theme>(this.readStored());

  readonly theme$ = this.themeSubject.asObservable();

  constructor() {
    this.apply(this.themeSubject.value);
  }

  get theme(): Theme {
    return this.themeSubject.value;
  }

  get isDark(): boolean {
    return this.theme === 'dark';
  }

  set(theme: Theme): void {
    this.themeSubject.next(theme);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not persisted this session; the page still switches.
    }

    this.apply(theme);
  }

  toggle(): void {
    this.set(this.isDark ? 'light' : 'dark');
  }

  private readStored(): Theme {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  private apply(theme: Theme): void {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;

    // Light leaves the attribute off, so the untouched light rules apply.
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }
}
