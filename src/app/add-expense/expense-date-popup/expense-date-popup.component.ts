import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-expense-date-popup',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './expense-date-popup.component.html',
  styleUrls: ['./expense-date-popup.component.css', './expense-date-popup.component.dark.css']
})
export class ExpenseDatePopupComponent {
  @Input() popupType: 'past' | 'future' = 'past';
  @Input() canAddDirectly = false;

  @Output() cancel = new EventEmitter<void>();
  @Output() add = new EventEmitter<void>();
  @Output() adminPermission = new EventEmitter<void>();
}