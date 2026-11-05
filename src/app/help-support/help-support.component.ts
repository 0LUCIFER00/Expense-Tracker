import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../auth.service';
import { BalanceService } from '../shared/balance.service';
import { SettingsService } from '../shared/settings.service';
import { WhatsappService, WhatsappLinkStatus } from '../shared/whatsapp.service';

interface Faq {
  question: string;
  answer: string;
}

/**
 * Where "Contact support" goes.
 *
 * A placeholder until there is somewhere real to send it: change this one line
 * rather than hunting through the template.
 */
const SUPPORT_ADDRESS = 'support@example.com';

@Component({
  selector: 'app-help-support',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './help-support.component.html',
  styleUrl: './help-support.component.css'
})
export class HelpSupportComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly balanceService = inject(BalanceService);
  private readonly settingsService = inject(SettingsService);
  private readonly whatsappService = inject(WhatsappService);

  /** Index of the open answer; null when they are all closed. */
  openFaq: number | null = null;

  whatsapp: WhatsappLinkStatus | null = null;
  hasAdminPassword = false;
  accountCount = 0;
  canSeeBalances = false;

  readonly supportMailto =
    `mailto:${SUPPORT_ADDRESS}?subject=${encodeURIComponent('Expense Tracker — help')}`;

  readonly whatsappCommands = [
    {
      send: '250 coffee',
      does: 'Records ₹250 for Coffee. No account named, so no balance changes.'
    },
    { send: '1200 groceries hdfc', does: 'Records it and takes ₹1,200 out of HDFC Bank.' },
    { send: '80 chai cash', does: 'The same, from your cash in hand.' },
    {
      send: '+50000 salary hdfc',
      does: 'Money in, not out. The leading + is what makes the difference.'
    },
    { send: '+300 refund paytm', does: 'The same, into your Paytm wallet.' },
    { send: 'balance', does: 'Lists every account and what is in each.' },
    { send: 'today', does: 'Everything recorded today, with the settled total.' },
    {
      send: 'undo',
      does: 'Removes the last thing you sent, money out or money in, and puts the money back.'
    },
    { send: 'help', does: 'Shows this list on your phone.' }
  ];

  /**
   * Splitting is a sequence — pay, get paid back, see who is left — so it is
   * set out as numbered steps around one worked example rather than mixed into
   * the list above.
   */
  readonly splitSteps = [
    {
      title: 'Pay for the group',
      send: '1455 vegetables hdfc split 4',
      does:
        'Takes ₹1,455 from HDFC Bank, split four ways with you included. Your share ' +
        'is ₹363 and the other three owe ₹364 each. Only your ₹363 counts as your ' +
        'spending.'
    },
    {
      title: 'When someone pays you back',
      send: '+364 vegetables share hdfc',
      does:
        'Puts ₹364 into HDFC Bank as a repayment of the vegetables split, not as ' +
        'income. Add who paid if you like: +364 Kalai vegetables share hdfc.'
    },
    {
      title: 'See who still owes you',
      send: 'splits',
      does: 'Every split with something left to collect, and what to send when it arrives.'
    }
  ];

  readonly faqs: Faq[] = [
    {
      question: 'Why did my expense not reduce the balance?',
      answer:
        'You did not name an account, or the name did not match one of yours. ' +
        '"hdfc" matches "HDFC Bank", but a name you have not created matches ' +
        'nothing and stays in the description.'
    },
    {
      question: 'I was asked which account I meant',
      answer:
        'Two of your accounts share that word — "bank" when you have both Indian ' +
        'Bank and HDFC Bank. Send it again with the fuller name. Guessing would ' +
        'quietly take money from the wrong one.'
    },
    {
      question: 'Why is my expense waiting for an admin?',
      answer:
        'It is dated in the past or the future, and this account does not have the ' +
        'backdating permission. Nothing has moved yet: an admin can approve it on ' +
        'Transactions, and the balance is only debited then.'
    },
    {
      question: 'I deleted an expense — where did the money go?',
      answer:
        'Back into the account it came from, as long as it had actually been taken ' +
        'out. Deleting it on Transactions and sending "undo" do the same thing. ' +
        'A pending entry never moved money, so nothing is returned.'
    },
    {
      question: 'How do I split a bill with friends?',
      answer:
        'Pay the whole bill as usual and say how many people it was for, counting ' +
        'yourself. On the website, tick "Split bill" on Add Expense and enter ' +
        'the number. On WhatsApp, add "split" and the number: "1455 vegetables hdfc ' +
        'split 4". The whole amount still leaves your account, but only your share ' +
        'counts as your spending.'
    },
    {
      question: 'How do I record a friend paying me back?',
      answer:
        'On Add Income, choose the expense under "Split repayment" — the amount ' +
        'and description fill themselves in. On WhatsApp, start with + and include ' +
        'the word "share": "+364 vegetables share hdfc". A word from the expense\'s ' +
        'name picks which split it is for; if only one split is waiting, no name is ' +
        'needed, and if two fit equally you are asked which.'
    },
    {
      question: 'Why does a repayment not count as money in?',
      answer:
        'Because you did not earn it — you fronted it. Counting it would make your ' +
        'income look ₹1,092 higher after a ₹1,455 shared shop. It still goes into the ' +
        'account, so your balance is right, and Transactions totals it separately ' +
        'as "Repaid".'
    },
    {
      question: 'How do I see who still owes me?',
      answer:
        'Click a split expense on Home or on Transactions: it opens to show who has ' +
        'paid, when, and what is still to come. Or send "splits" on WhatsApp.'
    },
    {
      question: 'What is the full-access password for?',
      answer:
        'It is a second password for the same account. Signing in with it gives you ' +
        'everything; signing in with your normal password gives you only what the ' +
        'toggles in Settings allow. The main use is hiding your balances: on a ' +
        'shared or public machine, sign in as a normal user and no amount appears ' +
        'anywhere, including in WhatsApp replies.'
    },
    {
      question: 'Why do some entries say “Uncategorised”?',
      answer:
        'Either they were added before categories existed, or they were filed ' +
        'without one. Over WhatsApp the category is read from what you wrote, and ' +
        'left blank when the words do not make it obvious.'
    },
    {
      question: 'I stopped getting replies',
      answer:
        'The WhatsApp access token expires. Replies stop but your expenses are still ' +
        'recorded — they just arrive silently until the token is renewed.'
    },
    {
      question: 'How do I record money coming in?',
      answer:
        'Add Income, beside Add Expense in the menu. It records where the money came ' +
        'from and credits the account in one go, so there is a trail — editing the ' +
        'figure on Cash & Accounts leaves none. Over WhatsApp, start the message ' +
        'with a + : "+50000 salary hdfc". Everything that came in is listed under ' +
        'Transactions → Credit.'
    },
    {
      question: 'Can I get my expenses out of the app?',
      answer:
        'Yes. "Export CSV" on Transactions downloads exactly the rows you are ' +
        'looking at, on whichever tab is open — All, Debit or Credit. ' +
        '"Download my data" on your profile takes the lot. Both open in Excel, ' +
        'Google Sheets or any spreadsheet.'
    }
  ];

  ngOnInit(): void {
    this.auth.ensureSession().subscribe(session => {
      this.hasAdminPassword = Boolean(session?.user.hasAdminPassword);
    });

    forkJoin({
      balances: this.balanceService.list(),
      settings: this.settingsService.load(true),
      // A help page is still useful without these, so they resolve to a default
      // rather than leaving the page empty.
      whatsapp: this.whatsappService.status().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ balances, whatsapp }) => {
        this.accountCount = balances.filter(account => account.saved).length;
        this.canSeeBalances = this.settingsService.canSeeBalances;
        this.whatsapp = whatsapp;
      },
      error: () => {
        this.whatsapp = null;
      }
    });
  }

  /**
   * One answer open at a time.
   *
   * <details> would toggle itself on click, which fights the bound [open], so
   * the default is prevented and the state kept here.
   */
  onToggleFaq(index: number, event: Event): void {
    event.preventDefault();
    this.openFaq = this.openFaq === index ? null : index;
  }
}
