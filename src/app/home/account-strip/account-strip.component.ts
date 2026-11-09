import { DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { DashboardAccount } from '../../shared/dashboard';

/**
 * The accounts across the top of Home.
 *
 * Six fit across a desktop (three on a tablet, two on a phone); any more sit
 * after them, out of view. To reach them: the arrows that appear at either end
 * while the pointer is over the strip (or a key has focus in it), the mouse
 * wheel anywhere over it, or a swipe on a touch screen.
 *
 * Every tile has the same shape, name and kind on top and the amount on the
 * line below, so a short balance never sits higher than a long one.
 */
@Component({
  selector: 'app-account-strip',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './account-strip.component.html',
  styleUrl: './account-strip.component.css'
})
export class AccountStripComponent implements AfterViewInit {
  @Input({ required: true }) accounts: DashboardAccount[] = [];

  @ViewChild('track', { static: true }) track!: ElementRef<HTMLElement>;

  /** Whether there is more to either side; the arrows only show when there is. */
  canBack = false;
  canForward = false;

  ngAfterViewInit(): void {
    // After the first layout, so the widths are real.
    setTimeout(() => this.update());
  }

  /** Called on scroll and resize: works out which arrows apply. */
  update(): void {
    const el = this.track.nativeElement;
    const max = el.scrollWidth - el.clientWidth;

    // A few pixels of slack: the strip rests a couple of pixels in, for the
    // tiles' shadow, and that is not "more to the left".
    this.canBack = el.scrollLeft > 4;
    this.canForward = el.scrollLeft < max - 4;
  }

  /** One screenful at a time: the next six (or however many fit). */
  page(direction: 1 | -1): void {
    const el = this.track.nativeElement;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    el.scrollBy({ left: direction * el.clientWidth, behavior: still ? 'auto' : 'smooth' });
  }

  /**
   * The mouse wheel scrolls the strip sideways while there is somewhere to go,
   * and the page as usual once it reaches either end.
   */
  onWheel(event: WheelEvent): void {
    const el = this.track.nativeElement;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const max = el.scrollWidth - el.clientWidth;

    if (max <= 0 || (delta < 0 && el.scrollLeft <= 0) || (delta > 0 && el.scrollLeft >= max - 1)) {
      return;
    }

    event.preventDefault();
    el.scrollLeft += delta;
  }
}
