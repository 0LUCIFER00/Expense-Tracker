
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
    readonly theme: ThemeService
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
        .subscribe(() => {
          this.menuOpen = false;
          this.showProfileMenu = false;
        })
    );
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
    this.router.navigate(['/login']);
  }
}
