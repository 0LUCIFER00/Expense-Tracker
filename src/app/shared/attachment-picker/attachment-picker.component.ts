import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { lastValueFrom, tap } from 'rxjs';
import {
  ACCEPT,
  Attachment,
  AttachmentService,
  isImage,
  prepareFile,
  sizeLabel
} from '../attachment.service';

interface Pending {
  key: number;
  name: string;
  size: number;
  type: string;
  /** A data: URL for an image's thumbnail; null for a PDF. */
  preview: string | null;
  blob: Blob | null;
  state: 'ready' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string;
}

let nextKey = 0;

/**
 * "Attach receipt": drop files or choose them, see each with a thumbnail, its
 * size and upload progress, and take any back out before it is sent.
 *
 * Two ways to use it:
 * - with `expenseId` set (an existing expense), each file uploads as soon as
 *   it is added and `uploaded` fires;
 * - without it (Add Expense, before the expense exists), files wait until the
 *   page calls `uploadAll(expenseId)` once the expense has been saved.
 */
@Component({
  selector: 'app-attachment-picker',
  standalone: true,
  templateUrl: './attachment-picker.component.html',
  styleUrl: './attachment-picker.component.css'
})
export class AttachmentPickerComponent {
  private readonly attachments = inject(AttachmentService);

  /** Upload straight away to this expense. */
  @Input() expenseId: string | null = null;
  /** How many more files the expense can take. */
  @Input() room = 10;
  @Input() compact = false;
  /** One line with small thumbnails and an Attach button, for a busy form. */
  @Input() inline = false;

  @Output() uploaded = new EventEmitter<Attachment>();

  items: Pending[] = [];
  dragging = false;
  notice = '';

  readonly accept = ACCEPT;
  readonly sizeLabel = sizeLabel;

  get waiting(): number {
    return this.items.filter(i => i.state === 'ready' || i.state === 'error').length;
  }

  /** The first file that could not be used or sent, if any. */
  get firstError(): Pending | null {
    return this.items.find(i => i.state === 'error') ?? null;
  }

  /** The inline line's heading: what is attached or waiting. */
  get inlineTitle(): string {
    const uploading = this.items.filter(i => i.state === 'uploading').length;
    const usable = this.items.filter(i => i.state !== 'error').length;

    if (uploading) {
      return `Uploading ${uploading} of ${usable}…`;
    }

    if (!usable) {
      return 'Attach receipt';
    }

    const noun = usable === 1 ? 'receipt' : 'receipts';
    return this.items.every(i => i.state === 'done' || i.state === 'error')
      ? `${usable} ${noun} attached`
      : `${usable} ${noun} ready`;
  }

  /** The inline line's second row: the first problem, or what happens next. */
  get inlineNote(): string {
    const error = this.firstError;

    if (error) {
      const others = this.items.filter(i => i.state === 'error').length - 1;
      return `${error.name}: ${error.error}${others > 0 ? ` (and ${others} more)` : ''}`;
    }

    if (!this.items.length) {
      return 'JPG, PNG, WebP or PDF · up to 4 MB';
    }

    return this.expenseId ? 'Sent as soon as you add them' : 'Attached when you save';
  }

  get busy(): boolean {
    return this.items.some(i => i.state === 'uploading');
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDragLeave(): void {
    this.dragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  onChoose(input: HTMLInputElement): void {
    this.add(Array.from(input.files ?? []));
    // So choosing the same file again still fires a change.
    input.value = '';
  }

  /** Adds files, checking and (for large photos) shrinking each one. */
  async add(files: File[]): Promise<void> {
    this.notice = '';
    const space = this.room - this.items.filter(i => i.state !== 'error').length;

    if (files.length > space) {
      this.notice = space > 0
        ? `Only ${space} more ${space === 1 ? 'file fits' : 'files fit'} on this expense (10 at most).`
        : 'This expense already has the most attachments it can take (10).';
      files = files.slice(0, Math.max(0, space));
    }

    for (const file of files) {
      const item: Pending = {
        key: nextKey++, name: file.name, size: file.size, type: file.type, preview: null,
        blob: null, state: 'ready', progress: 0, error: ''
      };
      this.items.push(item);

      const prepared = await prepareFile(file);

      if ('error' in prepared) {
        Object.assign(item, { state: 'error', error: prepared.error });
        continue;
      }

      Object.assign(item, { blob: prepared.blob, name: prepared.name, size: prepared.blob.size, type: prepared.blob.type || file.type });

      if (isImage(item.type)) {
        item.preview = await this.thumbnail(prepared.blob);
      }

      if (this.expenseId) {
        await this.send(item, this.expenseId);
      }
    }
  }

  remove(item: Pending): void {
    this.items = this.items.filter(i => i !== item);
  }

  /** Sends every waiting file to the expense; reports how many went and how many did not. */
  async uploadAll(expenseId: string): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const item of this.items.filter(i => i.state === 'ready')) {
      (await this.send(item, expenseId)) ? sent++ : failed++;
    }

    failed += this.items.filter(i => i.state === 'error' && i.blob === null).length;
    return { sent, failed };
  }

  /** Clears the list (after the expense form resets). */
  clear(): void {
    this.items = [];
    this.notice = '';
  }

  private async send(item: Pending, expenseId: string): Promise<boolean> {
    if (!item.blob) {
      return false;
    }

    item.state = 'uploading';
    item.progress = 0;

    try {
      const last = await lastValueFrom(
        this.attachments.upload(expenseId, item.blob, item.name).pipe(
          tap(event => { if ('progress' in event) item.progress = event.progress; })
        )
      );

      if ('done' in last) {
        item.state = 'done';
        item.progress = 100;
        this.uploaded.emit(last.done);
        return true;
      }

      throw new Error('The upload did not finish.');
    } catch (error) {
      item.state = 'error';
      item.error = (error as { message?: string }).message ?? 'The upload failed.';
      return false;
    }
  }

  /** A data: URL for the thumbnail (the site's image policy allows data:, not blob:). */
  private thumbnail(blob: Blob): Promise<string> {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  }
}
