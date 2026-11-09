import { HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';
import { ApiService } from './api.service';

/** A receipt or invoice attached to an expense. The file itself stays on the server. */
export interface Attachment {
  id: string;
  expenseId: string;
  fileName: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  size: number;
  createdAt: string;
}

/** Upload progress (0–100), then the stored attachment. */
export type UploadEvent = { progress: number } | { done: Attachment };

/** The server's limit per file: one request, under Vercel's 4.5 MB cap. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Receipts on an expense. Files are never handed out as public links: the
 * preview and download addresses below are this site's own API, which checks
 * the signed-in user owns the expense before streaming the file.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly api = inject(ApiService);

  list(expenseId: string): Observable<Attachment[]> {
    return this.api.get<Attachment[]>(`/expenses/${expenseId}/attachments`);
  }

  upload(expenseId: string, file: Blob, name: string): Observable<UploadEvent> {
    return this.api.upload<Attachment>(`/expenses/${expenseId}/attachments`, file, {
      'X-File-Name': encodeURIComponent(name)
    }).pipe(
      filter(event => event.type === HttpEventType.UploadProgress || event.type === HttpEventType.Response),
      map(event => event.type === HttpEventType.Response
        ? { done: event.body as Attachment }
        : { progress: event.total ? Math.round((event.loaded / event.total) * 100) : 0 })
    );
  }

  remove(expenseId: string, id: string): Observable<void> {
    return this.api.delete<void>(`/expenses/${expenseId}/attachments/${id}`);
  }

  /** Same-origin address for preview; the session cookie goes with it. */
  fileUrl(a: { expenseId: string; id: string }, download = false): string {
    return `/api/expenses/${a.expenseId}/attachments/${a.id}${download ? '?download=1' : ''}`;
  }
}

export function isImage(type: string): boolean {
  return IMAGE_TYPES.includes(type);
}

export function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Gets a chosen file ready to send: checks its type and size, and shrinks a
 * large photo (over 2.5 MB or 2560 px) to a JPEG that fits comfortably under
 * the limit. PDFs are sent as they are. The server checks everything again.
 *
 * @returns the bytes to send and the name, or an error to show
 */
export async function prepareFile(file: File): Promise<{ blob: Blob; name: string } | { error: string }> {
  const type = file.type || guessType(file.name);

  if (type === 'application/pdf') {
    return file.size > MAX_FILE_BYTES
      ? { error: `${file.name} is over 4 MB. Try a smaller or compressed PDF.` }
      : { blob: file, name: file.name };
  }

  if (!IMAGE_TYPES.includes(type)) {
    return { error: `${file.name}: only JPG, PNG, WebP images and PDF files can be attached.` };
  }

  if (file.size <= 2.5 * 1024 * 1024) {
    const dims = await imageSize(file).catch(() => null);

    if (!dims) {
      return { error: `${file.name} could not be read as an image.` };
    }

    if (Math.max(dims.width, dims.height) <= 2560) {
      return { blob: file, name: file.name };
    }
  }

  const shrunk = await shrink(file).catch(() => null);

  if (!shrunk) {
    return { error: `${file.name} could not be read as an image.` };
  }

  if (shrunk.size > MAX_FILE_BYTES) {
    return { error: `${file.name} is still over 4 MB after resizing.` };
  }

  return { blob: shrunk, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' } as Record<string, string>)[ext ?? ''] ?? '';
}

/** The image, decoded. Read as a data: URL, which the site's CSP allows for images. */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('not an image'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  const img = await loadImage(file);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** Longest side 2560 px, JPEG at 0.85: a receipt stays readable at a fraction of the size. */
async function shrink(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  // White under any transparency, as JPEG has none.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('could not encode')), 'image/jpeg', 0.85);
  });
}
