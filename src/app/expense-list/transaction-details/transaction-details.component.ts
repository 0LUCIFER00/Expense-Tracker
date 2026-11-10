import { DatePipe, DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Attachment, AttachmentService, isImage, sizeLabel } from '../../shared/attachment.service';
import { AttachmentPickerComponent } from '../../shared/attachment-picker/attachment-picker.component';
import { categoryIcon } from '../../shared/category-icons';
import { Expense, ImportedFrom, Income, SplitSummary } from '../../shared/models';
import { ToastService } from '../../shared/toast.service';

const MAX = 10;

/**
 * One transaction's details, opened by clicking its row in Transactions: a
 * drawer from the right on a wide screen, a sheet from the bottom on a phone.
 *
 * For an expense: the amount, the account it was paid from, your share and
 * who has paid back (when it was split), and its Receipts & Invoices. For
 * money in: where it went, and the split it pays back when it is a repayment.
 *
 * Approve and Remove live here rather than on the row, so an entry is never
 * removed by a stray click; Remove still asks first. The list does the work
 * (it already knows how to refund and reload); this only asks for it.
 */
@Component({
  selector: 'app-transaction-details',
  standalone: true,
  imports: [DatePipe, DecimalPipe, AttachmentPickerComponent],
  templateUrl: './transaction-details.component.html',
  styleUrls: ['./transaction-details.component.css', './transaction-preview.css']
})
export class TransactionDetailsComponent implements OnChanges, AfterViewInit {
  private readonly service = inject(AttachmentService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  @Input() expense: Expense | null = null;
  @Input() income: Income | null = null;
  /** The expense's own split, or the split a repayment pays back. */
  @Input() split: SplitSummary | null = null;
  @Input() canViewSource = true;
  @Input() canRemove = false;
  @Input() canApprove = false;

  @Output() closed = new EventEmitter<void>();
  /** The number of attachments now, so the list's paperclip can follow. */
  @Output() countChange = new EventEmitter<number>();
  @Output() remove = new EventEmitter<void>();
  @Output() approve = new EventEmitter<void>();
  /** A repayment's split was clicked: open that expense instead. */
  @Output() openSplit = new EventEmitter<string>();

  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;

  attachments: Attachment[] = [];
  loading = false;
  error = '';

  preview: Attachment | null = null;
  previewUrl: SafeResourceUrl | null = null;
  confirmFile: Attachment | null = null;
  removingFile = false;

  /** Remove was clicked once; the footer now asks to confirm. */
  confirmEntry = false;

  readonly isImage = isImage;
  readonly sizeLabel = sizeLabel;

  /** Where an imported entry came from, with its notes; null for one added here. */
  get imported(): ImportedFrom | null {
    return this.expense?.imported ?? this.income?.imported ?? null;
  }

  get isIncome(): boolean {
    return !this.expense && !!this.income;
  }

  get description(): string {
    return this.expense?.description ?? this.income?.description ?? '';
  }

  get amount(): number {
    return Number(this.expense?.amount ?? this.income?.amount ?? 0);
  }

  get date(): string {
    return this.expense?.date ?? this.income?.date ?? '';
  }

  get createdAt(): string {
    return this.expense?.createdAt ?? this.income?.createdAt ?? '';
  }

  /** The category, the income source, or "Repayment". */
  get category(): string {
    if (this.expense) {
      return this.expense.category ?? 'Uncategorised';
    }

    return this.income?.splitExpenseId ? 'Repayment' : this.income?.category ?? 'Uncategorised';
  }

  get icon(): string {
    return categoryIcon(this.category);
  }

  get account(): string | null {
    return this.expense?.sourceCategory ?? this.income?.targetCategory ?? null;
  }

  get pending(): boolean {
    return !!this.expense?.isPendingApproval;
  }

  /** How many facts come before "Added", so it can fill the row when alone. */
  get factsBeforeAdded(): number {
    return (this.canViewSource ? 1 : 0) + (this.expense?.splitMembers ? 1 : 0);
  }

  /** How much of the split has come back, for its bar. */
  get paidPercent(): number {
    const split = this.split;
    return split?.owed ? Math.min(100, (split.received / split.owed) * 100) : 0;
  }

  /** What removing it does to the money, said before it is done. */
  get removeNote(): string {
    const rupees = `₹${this.amount.toLocaleString('en-IN')}`;

    if (this.income) {
      return this.income.balanceUpdated && this.account
        ? `Removing takes ${rupees} back out of ${this.account}.`
        : 'Removing it changes no balance.';
    }

    const back = this.expense?.balanceUpdated && this.account
      ? `Removing puts ${rupees} back in ${this.account}.`
      : 'Removing it changes no balance.';

    return this.split?.repayments.length
      ? `${back} Its repayments stay as money in.`
      : back;
  }

  get room(): number {
    return MAX - this.attachments.length;
  }

  /**
   * Runs for the first entry and again whenever the drawer is switched to
   * another one (a repayment's split), so each shows its own receipts.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['expense'] && !changes['income']) {
      return;
    }

    this.attachments = [];
    this.error = '';
    this.confirmEntry = false;
    this.closePreview();

    if (!this.expense) {
      this.loading = false;
      return;
    }

    const id = this.expense.id;
    this.loading = true;
    this.service.list(id).subscribe({
      next: list => {
        if (this.expense?.id === id) {
          this.attachments = list;
          this.loading = false;
        }
      },
      error: error => {
        this.error = error.message;
        this.loading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    // Keyboard users land inside the drawer, on its Close button.
    this.closeButton?.nativeElement.focus();
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

  askRemoveFile(a: Attachment): void {
    this.confirmFile = a;
  }

  removeFile(): void {
    const a = this.confirmFile;

    if (!a) {
      return;
    }

    this.removingFile = true;
    this.service.remove(a.expenseId, a.id).subscribe({
      next: () => {
        this.removingFile = false;
        this.confirmFile = null;
        this.attachments = this.attachments.filter(x => x.id !== a.id);
        this.countChange.emit(this.attachments.length);
        if (this.preview?.id === a.id) this.closePreview();
        this.toast.success(`${a.fileName} removed. The expense is unchanged.`);
      },
      error: error => {
        this.removingFile = false;
        this.toast.error(error.message);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmFile) {
      this.confirmFile = null;
    } else if (this.preview) {
      this.closePreview();
    } else if (this.confirmEntry) {
      this.confirmEntry = false;
    } else {
      this.closed.emit();
    }
  }
}
