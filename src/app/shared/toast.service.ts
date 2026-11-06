import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastKind = 'success' | 'error' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** How long each kind stays up. An error gets longer: there is more to read. */
const LIFETIME = { success: 4000, error: 7000, warning: 7000 } as const;

/**
 * The app's notifications.
 *
 * Outcomes are announced here rather than printed into the page, so a page does
 * not jump when one arrives and a message raised just before navigating still
 * gets seen. Validation that belongs to a field stays beside that field — a
 * toast cannot point at the input that is wrong.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toastsSubject = new BehaviorSubject<Toast[]>([]);

  readonly toasts$ = this.toastsSubject.asObservable();

  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(text: string): void {
    this.show('success', text);
  }

  error(text: string): void {
    this.show('error', text);
  }

  /** Something worth noticing that is not a failure, such as a budget alert. */
  warning(text: string): void {
    this.show('warning', text);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.toastsSubject.next(this.toastsSubject.value.filter(toast => toast.id !== id));
  }

  private show(kind: ToastKind, text: string): void {
    const message = String(text ?? '').trim();

    if (!message) {
      return;
    }

    const id = this.nextId++;

    // Three at a time is enough to follow; older ones drop off the end so a
    // burst of failures cannot cover the page.
    const toasts = [...this.toastsSubject.value, { id, kind, text: message }].slice(-3);

    for (const dropped of this.toastsSubject.value) {
      if (!toasts.includes(dropped)) {
        this.clearTimer(dropped.id);
      }
    }

    this.toastsSubject.next(toasts);

    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), LIFETIME[kind])
    );
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
