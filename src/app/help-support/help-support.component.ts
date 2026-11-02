import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ApiService } from '../shared/api.service';

interface Faq {
  question: string;
  answer: string;
}

interface WhatsappStatus {
  available: boolean;
  connected: boolean;
  number: string | null;
}

@Component({
  selector: 'app-help-support',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './help-support.component.html',
  styleUrls: ['./help-support.component.css', './help-support.component.dark.css']
})
export class HelpSupportComponent implements OnInit {
  private readonly api = inject(ApiService);

  /** Index of the open answer; null when they are all closed. */
  openFaq: number | null = null;

  /** Whether this account has a phone linked, so the page can say which. */
  whatsapp: WhatsappStatus | null = null;

  readonly whatsappCommands = [
    { send: '250 coffee', does: 'Records ₹250 for "Coffee", filed under Food & Drink.' },
    {
      send: '1200 groceries hdfc',
      does: 'Records it and takes ₹1,200 out of your HDFC Bank balance.'
    },
    { send: '80 chai cash', does: 'Spends from Hand Cash instead.' },
    { send: 'balance', does: 'Lists your accounts and what is in each.' },
    { send: 'today', does: 'Lists what you have recorded today.' },
    { send: 'undo', does: 'Removes the last expense you sent, and puts the money back.' },
    { send: 'help', does: 'Shows this list on your phone.' }
  ];

  readonly faqs: Faq[] = [
    {
      question: 'What is the admin password for?',
      answer:
        'It is a second password for the same account. Signing in with it gives ' +
        'you everything; signing in with your normal password gives you only what ' +
        'the toggles in Settings allow. The main use is hiding your balances: on a ' +
        'shared or public machine, sign in as a normal user and no amount appears ' +
        'anywhere, including in WhatsApp replies.'
    },
    {
      question: 'Why is my expense "Pending / Waiting Admin"?',
      answer:
        'It was dated something other than today, and this account does not have ' +
        'permission to backdate or post-date an entry. Nothing has moved yet: it ' +
        'waits until someone signed in with the admin password approves it, and ' +
        'the balance is only debited then.'
    },
    {
      question: 'Does deleting an expense give the money back?',
      answer:
        'Yes, if that expense actually took money out of an account. Deleting it ' +
        'from the expense list and sending "undo" over WhatsApp do exactly the ' +
        'same thing. An entry that was only logged, or one whose account has since ' +
        'been deleted, has nothing to return.'
    },
    {
      question: 'Why do some entries say "Uncategorised"?',
      answer:
        'Either they were added before categories existed, or they were filed ' +
        'without one. Over WhatsApp the category is guessed from what you wrote, ' +
        'and left blank when the words do not make it obvious.'
    },
    {
      question: 'What happens if an account does not have enough in it?',
      answer:
        'Nothing is recorded. The app will not let a balance go negative, so the ' +
        'expense is refused and you are told how much the account actually holds ' +
        '(unless balances are hidden for this session).'
    },
    {
      question: 'Can I get my expenses out of the app?',
      answer:
        'Yes. On the View Expenses page, "Export CSV" downloads exactly the rows ' +
        'you are looking at, filters and sorting included. The file opens in Excel, ' +
        'Google Sheets or any spreadsheet.'
    },
    {
      question: 'I forgot my password.',
      answer:
        'There is no reset email yet. If you are still signed in anywhere, change ' +
        'it from your Profile page. Otherwise the account cannot currently be ' +
        'recovered, so keep the password somewhere safe.'
    }
  ];

  ngOnInit(): void {
    this.api.get<WhatsappStatus>('/whatsapp/link').subscribe({
      next: status => {
        this.whatsapp = status;
      },
      // A help page is still useful without it, so a failure is left silent.
      error: () => {
        this.whatsapp = null;
      }
    });
  }

  toggleFaq(index: number): void {
    this.openFaq = this.openFaq === index ? null : index;
  }
}
