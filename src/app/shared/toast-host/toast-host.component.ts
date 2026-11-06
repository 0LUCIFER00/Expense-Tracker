import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Toast, ToastService } from '../toast.service';

/**
 * Draws whatever the ToastService is holding.
 *
 * Mounted once in the app shell, outside the routed page, so a message raised
 * just before navigating survives the navigation that follows it.
 */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-host.component.html',
  styleUrl: './toast-host.component.css'
})
export class ToastHostComponent {
  private readonly toastService = inject(ToastService);

  readonly toasts$ = this.toastService.toasts$;

  onDismiss(toast: Toast): void {
    this.toastService.dismiss(toast.id);
  }
}
