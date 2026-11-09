
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { ThemeService } from '../shared/theme.service';
import { RecurringService, dateLabel } from '../shared/recurring.service';
import { ToastService } from '../shared/toast.service';
import { initialsOf } from '../shared/initials';

/** One page under a menu group. `badge` shows the recurring attention count. */
export interface NavItem {
  path: string;
  label: string;
  badge?: 'attention';
}

/**
 * Everything under Planning, defined once: the dropdown, the hamburger
 * submenu and the parent's active state all read this list.
 */
export const PLANNING_ITEMS: NavItem[] = [
  { path: '/budgets', label: 'Budgets' },
  { path: '/recurring', label: 'Recurring', badge: 'attention' },
  { path: '/goals', label: 'Savings Goals' }
];

/** Above this width the links sit in the header; below it, in the hamburger panel. */
const HOVER_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 1041px)';

/** A click this soon after a hover opened Planning is the same gesture, not a toggle. */
const HOVER_CLICK_GRACE_MS = 400;

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css', './header.component.dark.css']
})
export class HeaderComponent implements OnInit, OnDestroy {

  showBalanceManagement = false;
  showAddMoney = false;
  showProfileMenu = false;

  /** Recurring entries that need attention, shown as a count on the menu. */
  attention = 0;

  /** The signed-in person's name and its initials, for the account button. */
  userName = '';
  initials = '';

  /** Collapsed nav on small screens; the CSS ignores this above the breakpoint. */
  menuOpen = false;

  /** The Planning dropdown (or, in the hamburger panel, its submenu). */
  planningOpen = false;
  readonly planningItems = PLANNING_ITEMS;

  /** When hover last opened Planning, so the click that follows does not shut it. */
  private hoverOpenedAt = 0;

  @ViewChild('planningEl')
  planningEl?: ElementRef<HTMLElement>;

  @ViewChild('planningBtn')
  planningBtn?: ElementRef<HTMLButtonElement>;

  @ViewChild('profileMenu')
  profileMenu!: ElementRef<HTMLElement>;

  @ViewChild('headerEl')
  headerEl!: ElementRef<HTMLElement>;

  private subscriptions = new Subscription();

  constructor(
    private authService: AuthService,
    private router: Router,
    private settingsService: SettingsService,
    /** Public: the template reads isDark to pick the icon. */
    readonly theme: ThemeService,
    private recurring: RecurringService,
    private toast: ToastService
  ) { }

  toggleTheme(): void {
    this.theme.toggle();
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.settingsService.balanceAccess$.subscribe(access => {
        this.showBalanceManagement = access;
      })
    );

    this.subscriptions.add(
      this.settingsService.addMoneyAccess$.subscribe(access => {
        this.showAddMoney = access;
      })
    );

    // Routing from anywhere else (a button on a page, the back arrow) should
    // leave the mobile nav closed too.
    this.subscriptions.add(
      this.router.events
        .pipe(filter(event => event instanceof NavigationEnd))
        .subscribe(event => {
          this.menuOpen = false;
          this.showProfileMenu = false;
          this.planningOpen = false;
          this.catchUpRecurring((event as NavigationEnd).urlAfterRedirects);
        })
    );

    this.subscriptions.add(
      this.recurring.attention$.subscribe(count => {
        this.attention = count;
      })
    );

    this.subscriptions.add(
      this.authService.user$.subscribe(user => {
        this.userName = user?.name?.trim() ?? '';
        this.initials = initialsOf(user?.name);
      })
    );
  }

  /**
   * The first time a signed-in page opens, ask the server to add any recurring
   * entries that have come due, so they appear on their day even if the daily
   * job is late, and say what happened. The Recurring page does its own.
   */
  private catchUpRecurring(url: string): void {
    if (/^\/(login|register)?(\?|$)/.test(url) || url.startsWith('/recurring')) {
      return;
    }

    this.recurring.syncOnce().subscribe(result => {
      if (!result) {
        return;
      }

      if (result.added.length === 1) {
        const [entry] = result.added;
        this.toast.success(`Recurring: ${entry.description} was added for ${dateLabel(entry.dueOn, result.today)}.`);
      } else if (result.added.length > 1) {
        this.toast.success(`${result.added.length} recurring entries were added.`);
      }

      if (result.attention > 0) {
        this.toast.error(result.attention === 1
          ? 'A recurring entry could not be added. Open Recurring to try again or skip it.'
          : `${result.attention} recurring entries could not be added. Open Recurring to see them.`);
      }

      for (const schedule of result.reminders) {
        this.toast.warning(
          `Reminder: ${schedule.description} ₹${schedule.amount.toLocaleString('en-IN')} ` +
          `${schedule.kind === 'income' ? 'expected' : 'due'} ${dateLabel(schedule.nextDueOn, result.today)}.`
        );
      }

      for (const alert of result.budgetAlerts) {
        this.toast.warning(alert.message);
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as Node;

    if (
      this.showProfileMenu &&
      this.profileMenu &&
      !this.profileMenu.nativeElement.contains(target)
    ) {
      this.showProfileMenu = false;
    }

    if (
      this.menuOpen &&
      this.headerEl &&
      !this.headerEl.nativeElement.contains(target)
    ) {
      this.menuOpen = false;
    }

    if (
      this.planningOpen &&
      this.planningEl &&
      !this.planningEl.nativeElement.contains(target)
    ) {
      this.planningOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    // Escape from inside the Planning menu returns focus to its button, so a
    // keyboard user is not left on a link that has just been hidden.
    const focusInPlanning = this.planningOpen &&
      this.planningEl?.nativeElement.contains(document.activeElement);

    this.menuOpen = false;
    this.showProfileMenu = false;
    this.planningOpen = false;

    if (focusInPlanning) {
      this.planningBtn?.nativeElement.focus();
    }
  }

  /** Whether this pointer can hover and the links sit in the header (not the hamburger panel). */
  private canHover(): boolean {
    return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(HOVER_QUERY).matches;
  }

  /** Pointer over Planning or its menu: open it. Touch and the hamburger panel use taps instead. */
  onPlanningEnter(): void {
    if (!this.canHover() || this.planningOpen) {
      return;
    }

    this.planningOpen = true;
    this.showProfileMenu = false;
    this.hoverOpenedAt = Date.now();
  }

  /** Pointer has left both Planning and its menu (they share one wrapper): close it. */
  onPlanningLeave(): void {
    if (this.canHover()) {
      this.planningOpen = false;
    }
  }

  /**
   * Click or tap on Planning toggles it. A click that lands just after hover
   * opened it is the same gesture, so it keeps the menu open rather than
   * shutting it under the pointer.
   */
  togglePlanning(): void {
    if (this.planningOpen && Date.now() - this.hoverOpenedAt < HOVER_CLICK_GRACE_MS) {
      return;
    }

    this.planningOpen = !this.planningOpen;
    this.hoverOpenedAt = 0;

    if (this.planningOpen) {
      this.showProfileMenu = false;
    }
  }

  /** A page chosen from Planning: close the dropdown and the hamburger panel. */
  closePlanning(): void {
    this.planningOpen = false;
    this.menuOpen = false;
  }

  toggleMenu() {
    this.menuOpen = !this.menuOpen;

    if (this.menuOpen) {
      this.showProfileMenu = false;
    }
  }

  closeMenu() {
    this.menuOpen = false;
  }

  toggleProfileMenu() {
    this.showProfileMenu = !this.showProfileMenu;

    if (this.showProfileMenu) {
      this.menuOpen = false;
      this.planningOpen = false;
    }
  }

  closeProfileMenu() {
    this.showProfileMenu = false;
  }

  logout(): void {
    this.closeProfileMenu();
    this.closeMenu();

    // Navigate regardless: the cookie is cleared server-side, and a failed
    // request should not strand the user on a page they can no longer use.
    this.authService.logout().subscribe({
      next: () => this.afterLogout(),
      error: () => this.afterLogout()
    });
  }

  private afterLogout(): void {
    this.settingsService.reset();
    this.recurring.reset();
    this.router.navigate(['/login']);
  }
}
