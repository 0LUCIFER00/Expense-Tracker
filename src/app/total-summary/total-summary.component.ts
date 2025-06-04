import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-total-summary',
  imports: [],
  templateUrl: './total-summary.component.html',
})
export class TotalSummaryComponent {
  @Input() total = 0;
}