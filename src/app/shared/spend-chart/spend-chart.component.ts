import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { DashboardDay } from '../dashboard';

/**
 * A fortnight of daily spending, one bar per day.
 *
 * Fourteen fixed slots whatever the data: a chart reads as a chart even when
 * most days are empty, where one bar per expense would leave a card holding a
 * single stripe. Its own component so both dashboard layouts can use it and
 * neither stylesheet has to carry it.
 */
@Component({
  selector: 'app-spend-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './spend-chart.component.html',
  styleUrl: './spend-chart.component.css'
})
export class SpendChartComponent {
  @Input({ required: true }) days: DashboardDay[] = [];

  /** The busiest day in the window; the bars are scaled against it. */
  @Input() busiest = 0;

  @Input() title = 'Last 14 days';
}
