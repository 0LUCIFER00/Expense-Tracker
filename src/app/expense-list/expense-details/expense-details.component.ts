import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnInit, Output, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Attachment, AttachmentService, isImage, sizeLabel } from '../../shared/attachment.service';
import { AttachmentPickerComponent } from '../../shared/attachment-picker/attachment-picker.component';
import { Expense } from '../../shared/models';
import { ToastService } from '../../shared/toast.service';

const MAX = 10;

/**
 * An expense's details, with its Receipts & Invoices: thumbnails, a preview
 * (image or PDF), download, remove, and room to attach more.
 *
 * Attachments never change the expense: nothing here edits its amount, date,
 * account or status, and removing a receipt leaves the expense as it was.
 */
@Component({
  selector: 'app-expense-details',
  standalone: true,
  imports: [DatePipe, DecimalPipe, AttachmentPickerComponent],
  templateUrl: './expense-details.component.html',
  styleUrl: './expense-details.component.css'
})
export class ExpenseDetailsComponent implements OnInit {
  private readonly service = inject(AttachmentService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  @Input({ required: true }) expense!: Expense;
  @Input() canViewSource = true;
  @Input() canRemove = false;

  @Output() closed = new EventEmitter<void>();
  /** The number of attachments now, so the list's paperclip can follow. */
  @Output() countChange = new EventEmitter<number>();

  attachments: Attachment[] = [];
  loading = true;
  error = '';

  preview: Attachment | null = null;
  previewUrl: SafeResourceUrl | null = null;
  confirmRemove: Attachment | null = null;
  removing = false;

  readonly isImage = isImage;
  readonly sizeLabel = sizeLabel;

  get room(): number {
    return MAX - this.attachments.length;
  }

  ngOnInit(): void {
    this.service.list(this.expense.id).subscribe({
      next: list => {
        this.attachments = list;
        this.loading = false;
      },
      error: error => {
        this.error = error.message;
        this.loading = false;
      }
    });
  }

  url(a: Attachment, download = false): string {
    return this.service.fileUrl(a, download);
  }

  open(a: Attachment): void {
    this.preview = a;
    // Our own API address, checked by the server for ownership; trusted for the frame.
    this.previewUrl = a.contentType === 'application/pdf'
      ? this.sanitizer.bypassSecurityTrustResourceUrl(this.url(a))
      : null;
  }

  closePreview(): void {
    this.preview = null;
    this.previewUrl = null;
  }

  onUploaded(a: Attachment): void {
    this.attachments = [...this.attachments, a];
    this.countChange.emit(this.attachments.length);
  }

  askRemove(a: Attachment): void {
    this.confirmRemove = a;
  }

  remove(): void {
    const a = this.confirmRemove;

    if (!a) {
      return;
    }

    this.removing = true;
    this.service.remove(a.expenseId, a.id).subscribe({
      next: () => {
        this.removing = false;
        this.confirmRemove = null;
        this.attachments = this.attachments.filter(x => x.id !== a.id);
        this.countChange.emit(this.attachments.length);
        if (this.preview?.id === a.id) this.closePreview();
        this.toast.success(`${a.fileName} removed. The expense is unchanged.`);
      },
      error: error => {
        this.removing = false;
        this.toast.error(error.message);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmRemove) {
      this.confirmRemove = null;
    } else if (this.preview) {
      this.closePreview();
    } else {
      this.closed.emit();
    }
  }
}
