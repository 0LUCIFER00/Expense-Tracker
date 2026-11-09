import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccountStripComponent } from './account-strip.component';
import { DashboardAccount } from '../../shared/dashboard';

function accounts(count: number): DashboardAccount[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Account ${i + 1}`,
    kind: 'Bank Account',
    balance: (count - i) * 1000,
    share: 100
  }));
}

describe('AccountStripComponent', () => {
  let fixture: ComponentFixture<AccountStripComponent>;
  let strip: AccountStripComponent;

  function build(count: number): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [AccountStripComponent] });
    fixture = TestBed.createComponent(AccountStripComponent);
    strip = fixture.componentInstance;
    strip.accounts = accounts(count);

    const host = fixture.nativeElement as HTMLElement;
    host.style.width = '1000px';
    document.body.appendChild(host);
    fixture.detectChanges();

    // Snapping is a browser animation; the tests check positions directly.
    (host.querySelector('.track') as HTMLElement).style.scrollSnapType = 'none';
    strip.update();
    fixture.detectChanges();

    return host;
  }

  /** How many fit across at the test browser's width: 6, 3 or 2. */
  function cols(host: HTMLElement): number {
    return Number(getComputedStyle(host).getPropertyValue('--cols'));
  }

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('puts every amount on the line under the name, whatever its length', () => {
    const host = build(2);
    const tiles = host.querySelectorAll('.tile');

    expect(tiles.length).toBe(2);
    tiles.forEach(tile => {
      const top = tile.querySelector('.top')!.getBoundingClientRect();
      const amount = tile.querySelector('.amount')!.getBoundingClientRect();
      expect(amount.top).toBeGreaterThanOrEqual(top.bottom - 1);
      expect(getComputedStyle(tile.querySelector('.amount')!).textAlign).toBe('center');
    });
  });

  it('fits as many as there are columns, with no arrows', () => {
    const probe = build(1);
    const across = cols(probe);
    const host = build(across);
    const track = host.querySelector('.track') as HTMLElement;

    expect([2, 3, 6]).toContain(across);
    expect(track.scrollWidth).toBeLessThanOrEqual(track.clientWidth + 1);
    expect(host.querySelector('.arrow')).toBeNull();
  });

  it('keeps the next account out of view, with an arrow forward to it', () => {
    const across = cols(build(1));
    const host = build(across + 2);
    const track = host.querySelector('.track') as HTMLElement;
    const next = host.querySelectorAll('.tile')[across].getBoundingClientRect();

    expect(next.left).toBeGreaterThanOrEqual(track.getBoundingClientRect().right - 1);
    expect(host.querySelector('.arrow.forward')).not.toBeNull();
    expect(host.querySelector('.arrow.back')).toBeNull();
  });

  it('turns the mouse wheel into a sideways scroll while there is somewhere to go', () => {
    const across = cols(build(1));
    const host = build(across + 2);
    const track = host.querySelector('.track') as HTMLElement;

    // At the start, scrolling up is left to the page.
    const up = new WheelEvent('wheel', { deltaY: -120, cancelable: true });
    strip.onWheel(up);
    expect(up.defaultPrevented).toBeFalse();

    const down = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    strip.onWheel(down);
    expect(track.scrollLeft).toBeGreaterThan(0);
    expect(down.defaultPrevented).toBeTrue();
  });

  it('leaves the wheel to the page when everything already fits', () => {
    build(1);
    const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    strip.onWheel(event);
    expect(event.defaultPrevented).toBeFalse();
  });
});
