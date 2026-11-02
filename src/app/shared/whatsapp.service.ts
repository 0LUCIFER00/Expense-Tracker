import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface WhatsappLinkStatus {
  /** False when the server has no WhatsApp credentials configured. */
  available: boolean;
  connected: boolean;
  /** Masked, e.g. "••••• 3210". Null when not connected. */
  number: string | null;
  /** The business number to message, when the server knows it. */
  businessNumber: string | null;
}

export interface WhatsappLinkCode {
  code: string;
  expiresInMinutes: number;
  businessNumber: string | null;
  /** wa.me link that opens WhatsApp with "link CODE" already typed. */
  chatUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class WhatsappService {
  private readonly api = inject(ApiService);

  status(): Observable<WhatsappLinkStatus> {
    return this.api.get<WhatsappLinkStatus>('/whatsapp/link');
  }

  requestCode(): Observable<WhatsappLinkCode> {
    return this.api.post<WhatsappLinkCode>('/whatsapp/link/code');
  }

  disconnect(): Observable<void> {
    return this.api.delete<void>('/whatsapp/link');
  }
}
