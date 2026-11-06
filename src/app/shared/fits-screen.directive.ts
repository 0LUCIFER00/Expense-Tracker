
import { Directive, OnDestroy, OnInit, inject, DOCUMENT } from '@angular/core';

/**
 * Marks a page that is meant to fit the window without the page scrolling.
 *
 * The shell is normally `min-height: 100vh`, so it grows to whatever the page
 * needs and the window scrolls. A page that wants to fit instead needs the
 * shell pinned to the viewport, and that lives above the routed component — so
 * this sets a class on <body> for as long as such a page is open, which
 * styles.css keys off. The page itself still decides how to use the height.
 *
 * Only takes effect on a window with the room; the rules are inside a media
 * query, so a short or narrow screen scrolls as it always did.
 */
@Directive({
  selector: '[appFitsScreen]',
  standalone: true
})
export class FitsScreenDirective implements OnInit, OnDestroy {
  private readonly document = inject(DOCUMENT);

  ngOnInit(): void {
    this.document.body.classList.add('fits-screen');
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('fits-screen');
  }
}
