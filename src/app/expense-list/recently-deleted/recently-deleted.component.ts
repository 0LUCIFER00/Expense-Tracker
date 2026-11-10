import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError } from '../../shared/api.service';
import { DeletedEntry } from '../../shared/models';
import { RecycleBinService } from '../../shared/recycle-bin.service';
import { ToastService } from '../../shared/toast.service';

export type BinKind = 'all' | 'expense' | 'income';

/** What the confirmation dialog is asking about. */
type Confirming =
  | { action: 'restore'; entry: DeletedEntry }
  | { action: 'purge'; entry: DeletedEntry }
  | { action: 'empty' };

/**
 * Recently deleted, in the Transactions page's list area: removed expenses and
 * income for 30 days, each with Restore and Delete for good, plus filters, a
 * search and Empty. Every action asks first; the server re-checks everything
 * (money, permissions, ownership) and its refusal is shown as said.
 */
@Component({
  selector: 'app-recently-deleted',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recently-deleted.component.html',
  styleUrl: './recently-deleted.component.css'
})
export class RecentlyDeletedComponent implements OnInit {
  private readonly bin = inject(RecycleBinService);
  private readonly toast = inject(ToastService);

  /** After a restore, so the list, totals and Home pick the entry up again. */
  @Output() restored = new EventEmitter<void>();

  readonly kinds: { value: BinKind; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'expense', label: 'Expenses' },
    { value: 'income', label: 'Income' }
  ];

  entries: DeletedEntry[] = [];
  retentionDays = 30;
  canManage = false;
  loading = true;
  loadError = '';

  kind: BinKind = 'all';
  search = '';

  confirming: Confirming | null = null;
  busy = false;
  confirmError = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';

    this.bin.list().subscribe({
      next: result => {
        this.entries = result.entries;
        this.retentionDays = result.retentionDays;
        this.canManage = result.canManage;
        this.loading = false;
      },
      error: (error: ApiError) => {
        this.loadError = error.message;
        this.loading = false;
      }
    });
  }

  /** The entries the kind filter and search leave showing. */
  get visible(): DeletedEntry[] {
    const needle = this.search.trim().toLowerCase();

    return this.entries.filter(entry =>
      (this.kind === 'all' || entry.kind === this.kind) &&
      (!needle || entry.description.toLowerCase().includes(needle)));
  }

  setKind(kind: BinKind): void {
    this.kind = kind;
  }

  ask(confirming: Confirming): void {
    this.confirming = confirming;
    this.confirmError = '';
  }

  cancel(): void {
    if (!this.busy) {
      this.confirming = null;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancel();
  }

  confirm(): void {
    const confirming = this.confirming;

    if (!confirming || this.busy) {
      return;
    }

    this.busy = true;
    this.confirmError = '';

    const done = (message: string, reloadList: boolean) => {
      this.busy = false;
      this.confirming = null;
      this.toast.success(message);
      this.load();

      if (reloadList) {
        this.restored.emit();
      }
    };
    const failed = (error: ApiError) => {
      this.busy = false;
      // Kept open with the reason: "Not enough in Cash…" needs reading.
      this.confirmError = error.message;
    };

    if (confirming.action === 'restore') {
      this.bin.restore(confirming.entry).subscribe({
        next: result => {
          const money = result.movedMoney && result.account
            ? (result.kind === 'expense'
              ? ` ${this.rupees(confirming.entry.amountPaise)} taken out of ${result.account} again.`
              : ` ${this.rupees(confirming.entry.amountPaise)} back in ${result.account}.`)
            : '';
          done(`Restored ${result.description}.${money}`, true);

          for (const alert of result.budgetAlerts ?? []) {
            this.toast.warning(alert.message);
          }
        },
        error: failed
      });
    } else if (confirming.action === 'purge') {
      this.bin.purge(confirming.entry).subscribe({
        next: () => done(`${confirming.entry.description} deleted for good.`, false),
        error: failed
      });
    } else {
      this.bin.empty().subscribe({
        next: result => done(
          `${result.purged} entr${result.purged === 1 ? 'y' : 'ies'} deleted for good.`, false),
        error: failed
      });
    }
  }

  // ------------------------------------------------------------ the dialog's words

  get confirmTitle(): string {
    const c = this.confirming;

    if (!c) return '';
    if (c.action === 'empty') return 'Empty Recently deleted?';

    return c.action === 'restore' ? `Restore ${c.entry.description}?` : `Delete ${c.entry.description} for good?`;
  }

  get confirmBody(): string[] {
    const c = this.confirming;

    if (!c) return [];

    if (c.action === 'empty') {
      return [
        `All ${this.entries.length} entr${this.entries.length === 1 ? 'y is' : 'ies are'} deleted for good, with their receipts.`,
        'This cannot be undone. No balance changes: their money was put back when they were removed.'
      ];
    }

    const e = c.entry;
    const amount = this.rupees(e.amountPaise);

    if (c.action === 'purge') {
      return [
        'This cannot be undone.' + (e.attachmentCount
          ? ` Its ${e.attachmentCount} receipt${e.attachmentCount === 1 ? ' is' : 's are'} deleted too.`
          : ''),
        e.splitMembers
          ? 'Repayments made against it stay, as ordinary money in.'
          : 'No balance changes: its money was put back when it was removed.'
      ];
    }

    const lines = [`It comes back as it was, dated ${this.shortDate(e.date)}.`];

    if (e.pending) {
      lines.push('It is still waiting for approval, so no money moves yet.');
    } else if (e.movedMoney) {
      const where = e.account ?? 'its account';
      lines.push(e.kind === 'expense'
        ? `${amount} is taken out of ${where} again.`
        : `${amount} goes back into ${where}.`);
    } else {
      lines.push('No balance changes.');
    }

    if (e.repays) {
      lines.push(`It counts as paying back ${e.repays} again.`);
    }

    return lines;
  }

  get confirmLabel(): string {
    const c = this.confirming;

    if (!c) return '';
    if (c.action === 'restore') return this.busy ? 'Restoring…' : 'Restore';

    return this.busy ? 'Deleting…' : c.action === 'empty' ? 'Empty it' : 'Delete for good';
  }

  // ------------------------------------------------------------ display

  rupees(paise: number): string {
    const digits = paise % 100 === 0 ? 0 : 2;

    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  shortDate(iso: string): string {
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso));
  }

  daysLabel(entry: DeletedEntry): string {
    if (entry.daysLeft <= 0) return 'Today';

    return `${entry.daysLeft} day${entry.daysLeft === 1 ? '' : 's'}`;
  }
}
