import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { SplitSummary } from '../models';

/**
 * What a split expense expands to show: how it was divided, who has paid back
 * and when, and what is still to come.
 *
 * Shared by the dashboard's recent list and Transactions, so the two read the
 * same and cannot disagree about what is owed.
 */
@Component({
  selector: 'app-split-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './split-history.component.html',
  styleUrl: './split-history.component.css'
})
export class SplitHistoryComponent {
  @Input({ required: true }) split!: SplitSummary;
}
