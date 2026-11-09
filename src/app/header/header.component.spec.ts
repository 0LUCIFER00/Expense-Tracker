import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { HeaderComponent, PLANNING_ITEMS } from './header.component';
import { RecurringService } from '../shared/recurring.service';

@Component({ standalone: true, template: '' })
class BlankPage {}

describe('HeaderComponent — Planning menu', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let header: HeaderComponent;
  let http: HttpTestingController;
  let router: Router;
  let hover = true;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideRouter([
          { path: 'home', component: BlankPage },
          { path: 'budgets', component: BlankPage },
          { path: 'recurring', component: BlankPage },
          { path: 'goals', component: BlankPage },
          { path: 'transactions', component: BlankPage }
        ]),
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    // Whether this "device" can hover with the links in the header.
    hover = true;
    spyOn(window, 'matchMedia').and.callFake(
      (query: string) => ({ matches: hover, media: query } as MediaQueryList)
    );

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(HeaderComponent);
    header = fixture.componentInstance;
    fixture.detectChanges();
  });

  // The header asks for recurring catch-up and settings as pages open; not under test here.
  afterEach(() => http.match(() => true));

  const el = () => fixture.nativeElement as HTMLElement;
  const group = () => el().querySelector('.nav-group') as HTMLElement;
  const button = () => el().querySelector('.nav-group-btn') as HTMLButtonElement;
  const isOpen = () => group().classList.contains('open');

  function enter(): void {
    button().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
  }

  function leave(): void {
    group().dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
  }

  function click(target: HTMLElement): void {
    target.click();
    fixture.detectChanges();
  }

  it('keeps Home, Add Expense, Transactions, Planning and Cash & Accounts in the bar, and Budgets, Recurring, Savings Goals under Planning', () => {
    const top = Array.from(el().querySelectorAll('.nav-links > a, .nav-group-btn'))
      .map(a => a.textContent!.replace(/\s+/g, ' ').trim());

    expect(top).toContain('Home');
    expect(top).toContain('Transactions');
    expect(top.some(t => t.startsWith('Planning'))).toBeTrue();
    expect(top).not.toContain('Budgets');
    expect(top).not.toContain('Recurring');

    const under = Array.from(el().querySelectorAll('.nav-dropdown a')).map(a => a.textContent!.trim());
    expect(under).toEqual(['Budgets', 'Recurring', 'Savings Goals']);
    expect(PLANNING_ITEMS.map(i => i.path)).toEqual(['/budgets', '/recurring', '/goals']);
  });

  it('opens on hover and closes when the pointer leaves', () => {
    enter();
    expect(isOpen()).toBeTrue();
    expect(button().getAttribute('aria-expanded')).toBe('true');

    leave();
    expect(isOpen()).toBeFalse();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('hover reopens it after a page was chosen with the pointer still over the menu', fakeAsync(() => {
    enter();
    const budgets = el().querySelector('.nav-dropdown a') as HTMLAnchorElement;
    click(budgets);
    tick();
    fixture.detectChanges();
    expect(isOpen()).toBeFalse();

    // No mouseleave from the wrapper: the pointer goes straight back to Planning.
    enter();
    expect(isOpen()).toBeTrue();
  }));

  it('stays open while the pointer moves from Planning into its menu', () => {
    enter();
    const menu = el().querySelector('#planning-menu') as HTMLElement;

    // The menu is inside the same wrapper, so moving onto it never leaves it.
    expect(group().contains(menu)).toBeTrue();
    menu.dispatchEvent(new MouseEvent('mouseenter'));
    menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();
    expect(isOpen()).toBeTrue();
  });

  it('a click toggles it, and a click straight after hover does not shut it', fakeAsync(() => {
    enter();
    click(button());
    expect(isOpen()).toBeTrue();

    tick(500);
    click(button());
    expect(isOpen()).toBeFalse();

    click(button());
    expect(isOpen()).toBeTrue();
  }));

  it('on touch, or inside the hamburger panel, hover does nothing and a tap toggles', () => {
    hover = false;

    enter();
    expect(isOpen()).toBeFalse();

    click(button());
    expect(isOpen()).toBeTrue();

    leave();
    expect(isOpen()).toBeTrue();

    click(button());
    expect(isOpen()).toBeFalse();
  });

  it('choosing a page navigates and closes the menu (and the hamburger panel)', fakeAsync(() => {
    header.menuOpen = true;
    click(button());

    const recurring = Array.from(el().querySelectorAll('.nav-dropdown a'))
      .find(a => a.textContent!.includes('Recurring')) as HTMLAnchorElement;
    click(recurring);
    tick();
    fixture.detectChanges();

    expect(router.url).toBe('/recurring');
    expect(isOpen()).toBeFalse();
    expect(header.menuOpen).toBeFalse();
  }));

  it('a click anywhere outside closes it; a click inside the menu does not', () => {
    click(button());
    (el().querySelector('#planning-menu') as HTMLElement).click();
    fixture.detectChanges();
    expect(isOpen()).toBeTrue();

    document.body.click();
    fixture.detectChanges();
    expect(isOpen()).toBeFalse();
  });

  it('Escape closes it and puts focus back on Planning', () => {
    // Focus needs the elements in the document, and visible: the test browser
    // is narrow, so the links live in the hamburger panel, which is opened here.
    document.body.appendChild(el());
    header.menuOpen = true;
    click(button());
    (el().querySelector('.nav-dropdown a') as HTMLElement).focus();
    expect(document.activeElement!.closest('.nav-dropdown')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(isOpen()).toBeFalse();
    expect(document.activeElement).toBe(button());
    el().remove();
  });

  it('any route change closes it, including back and forward', fakeAsync(() => {
    click(button());
    router.navigateByUrl('/transactions');
    tick();
    fixture.detectChanges();
    expect(isOpen()).toBeFalse();
  }));

  it('marks Planning, and the page inside it, as current on a Planning page', fakeAsync(() => {
    router.navigateByUrl('/goals');
    tick();
    fixture.detectChanges();

    expect(button().classList).toContain('active');
    const goals = Array.from(el().querySelectorAll('.nav-dropdown a')).find(a => a.textContent!.includes('Savings Goals'))!;
    expect(goals.classList).toContain('active');
    expect(goals.getAttribute('aria-current')).toBe('page');

    router.navigateByUrl('/transactions');
    tick();
    fixture.detectChanges();
    expect(button().classList).not.toContain('active');
  }));

  it('keeps the recurring count on Planning, open or closed, and beside Recurring inside it', () => {
    (TestBed.inject(RecurringService) as unknown as { attentionSubject: { next(n: number): void } })
      .attentionSubject.next(2);
    fixture.detectChanges();

    expect(button().querySelector('.nav-badge')!.textContent).toContain('2');

    click(button());
    expect(isOpen()).toBeTrue();
    expect(button().querySelector('.nav-badge')!.textContent).toContain('2');
    const recurring = Array.from(el().querySelectorAll('.nav-dropdown a')).find(a => a.textContent!.includes('Recurring'))!;
    expect(recurring.querySelector('.nav-badge')!.textContent).toContain('2');
  });

  it('no longer lists Savings Goals in the account menu', () => {
    click(el().querySelector('.profile-btn') as HTMLElement);
    const items = Array.from(el().querySelectorAll('.profile-dropdown a')).map(a => a.textContent!.trim());

    expect(items.some(i => i.includes('Savings Goals'))).toBeFalse();
    expect(items.some(i => i.includes('Settings'))).toBeTrue();
  });
});
