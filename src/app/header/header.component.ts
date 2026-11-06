
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
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuOpen = false;
    this.showProfileMenu = false;
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
