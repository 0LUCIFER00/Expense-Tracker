/**
 * The sample files offered under Import: an expense, an income and a combined
 * template, each as CSV and as an Excel workbook.
 *
 * The examples use the person's own account names where they have accounts, so
 * the file shows exactly what to write. They are also recognised on import and
 * left out unless the person keeps them (see isSampleRow).
 */
import { toCsv } from '../csv';
import { WriteCell, WriteSheet, columnName, isoToSerial, writeXlsx } from './xlsx';

export type TemplateKind = 'expense' | 'income' | 'combined';

export interface TemplateContext {
  /** YYYY-MM-DD; the examples are dated a few days before it. */
  today: string;
  /** Account names as on Cash & Accounts, with their types. */
  accounts: { name: string; type: string }[];
  expenseCategories: string[];
  incomeCategories: string[];
}

export const TEMPLATE_HEADERS = ['Date', 'Description', 'Amount', 'Category', 'Account', 'Notes', 'Payment Method'];

interface Example {
  daysAgo: number;
  type: 'Expense' | 'Income';
  description: string;
  amount: number;
  category: string;
  account: 'cash' | 'bank' | '';
  notes: string;
  paymentMethod: string;
}

const EXPENSES: Example[] = [
  { daysAgo: 3, type: 'Expense', description: 'Lunch at office canteen', amount: 180, category: 'Food & Drink',
    account: 'cash', notes: 'Paid for two', paymentMethod: 'Cash' },
  { daysAgo: 2, type: 'Expense', description: 'Electricity bill', amount: 1450.5, category: 'Bills & Utilities',
    account: 'bank', notes: 'October reading', paymentMethod: 'UPI' },
  { daysAgo: 1, type: 'Expense', description: 'Weekly vegetables', amount: 620, category: 'Groceries',
    account: '', notes: 'No account: listed only', paymentMethod: 'UPI' }
];

const INCOMES: Example[] = [
  { daysAgo: 6, type: 'Income', description: 'Salary for October', amount: 45000, category: 'Salary',
    account: 'bank', notes: '', paymentMethod: 'Bank transfer' },
  { daysAgo: 4, type: 'Income', description: 'Refund for returned headphones', amount: 1299, category: 'Refund',
    account: 'bank', notes: 'Order 4471', paymentMethod: 'UPI' },
  { daysAgo: 1, type: 'Income', description: 'Freelance logo design', amount: 3500, category: 'Business',
    account: 'cash', notes: 'Invoice 12', paymentMethod: 'Cash' }
];

function examplesFor(kind: TemplateKind): Example[] {
  if (kind === 'expense') return EXPENSES;
  if (kind === 'income') return INCOMES;

  return [INCOMES[0], EXPENSES[1], EXPENSES[0]];
}

function daysBefore(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);

  return date.toISOString().slice(0, 10);
}

/** The person's cash-like and bank-like accounts, or placeholders when they have none. */
function accountNames(context: TemplateContext): { cash: string; bank: string } {
  const accounts = context.accounts;
  const cashLike = accounts.find(a => /cash/i.test(`${a.type} ${a.name}`));
  const bankLike = accounts.find(a => a !== cashLike && /bank|account|card|savings/i.test(`${a.type} ${a.name}`))
    ?? accounts.find(a => a !== cashLike);

  return {
    cash: cashLike?.name ?? accounts[0]?.name ?? 'Cash',
    bank: bankLike?.name ?? accounts[0]?.name ?? 'Bank'
  };
}

export function templateHeaders(kind: TemplateKind): string[] {
  return kind === 'combined' ? ['Date', 'Type', ...TEMPLATE_HEADERS.slice(1)] : TEMPLATE_HEADERS;
}

function exampleRows(kind: TemplateKind, context: TemplateContext) {
  const names = accountNames(context);

  return examplesFor(kind).map(example => ({
    ...example,
    date: daysBefore(context.today, example.daysAgo),
    accountName: example.account ? names[example.account] : ''
  }));
}

export function templateFileName(kind: TemplateKind, ext: 'csv' | 'xlsx'): string {
  const name = kind === 'combined' ? 'expense-and-income' : kind;

  return `${name}-import-template.${ext}`;
}

/** The CSV template: headings and example rows. */
export function templateCsv(kind: TemplateKind, context: TemplateContext): { headers: string[]; rows: string[][] } {
  const rows = exampleRows(kind, context).map(row => {
    const cells = [row.date, row.description, row.amount.toFixed(2).replace(/\.00$/, ''), row.category,
      row.accountName, row.notes, row.paymentMethod];

    return kind === 'combined' ? [cells[0], row.type, ...cells.slice(1)] : cells;
  });

  return { headers: templateHeaders(kind), rows };
}

/** Full CSV text, for tests and anything that wants it whole. */
export function templateCsvText(kind: TemplateKind, context: TemplateContext): string {
  const { headers, rows } = templateCsv(kind, context);

  return toCsv(headers, rows);
}

const text = (value: string, style?: WriteCell['style']): WriteCell => ({ value, style });

/** The Excel template: the Transactions sheet, Instructions and the Lists the drop-downs use. */
export function templateXlsx(kind: TemplateKind, context: TemplateContext): Uint8Array {
  const headers = templateHeaders(kind);
  const col = (name: string) => columnName(headers.indexOf(name));
  const examples = exampleRows(kind, context);

  const transactions: WriteSheet = {
    name: 'Transactions',
    freezeHeader: true,
    widths: headers.map(h => ({ Date: 13, Type: 11, Description: 34, Amount: 12, Category: 20, Account: 20,
      Notes: 28, 'Payment Method': 17 } as Record<string, number>)[h] ?? 14),
    rows: [
      headers.map(h => text(h, 'header')),
      ...examples.map(row => {
        const cells: WriteCell[] = [
          { value: isoToSerial(row.date), style: 'date' },
          text(row.description),
          { value: row.amount, style: 'money' },
          text(row.category),
          text(row.accountName),
          text(row.notes),
          text(row.paymentMethod)
        ];

        return kind === 'combined' ? [cells[0], text(row.type), ...cells.slice(1)] : cells;
      })
    ],
    lists: []
  };

  // Categories, accounts and types, which the drop-downs point at.
  const categories = kind === 'income' ? context.incomeCategories
    : kind === 'expense' ? context.expenseCategories
      : [...context.expenseCategories, ...context.incomeCategories.filter(c => !context.expenseCategories.includes(c))];
  const accounts = context.accounts.map(a => a.name);
  const listRows = Math.max(categories.length, accounts.length, 2);
  const lists: WriteSheet = {
    name: 'Lists',
    widths: [24, 24, 12],
    rows: [
      [text('Categories', 'header'), text('Your accounts', 'header'), text('Types', 'header')],
      ...Array.from({ length: listRows }, (_, i) => [
        text(categories[i] ?? ''),
        text(accounts[i] ?? (i === 0 && !accounts.length ? 'Add accounts on Cash & Accounts first' : '')),
        text(['Expense', 'Income'][i] ?? '')
      ])
    ]
  };

  const range = (column: string, count: number) => `Lists!$${column}$2:$${column}$${count + 1}`;
  transactions.lists!.push({ cells: `${col('Category')}2:${col('Category')}2001`, source: range('A', categories.length) });

  if (accounts.length) {
    transactions.lists!.push({ cells: `${col('Account')}2:${col('Account')}2001`, source: range('B', accounts.length) });
  }

  if (kind === 'combined') {
    transactions.lists!.push({ cells: `${col('Type')}2:${col('Type')}2001`, source: ['Expense', 'Income'] });
  }

  return writeXlsx([transactions, instructionsSheet(kind), lists]);
}

function instructionsSheet(kind: TemplateKind): WriteSheet {
  const what = kind === 'expense' ? 'expenses' : kind === 'income' ? 'income' : 'expenses and income';
  const guide: [string, string, string][] = [
    ['Date', 'Yes', 'The day it happened. Best as YYYY-MM-DD, like 2026-11-05. Day-first dates also work: ' +
      '05/11/2026, 05-11-2026, 5 Nov 2026. Month-first dates (11/05/2026) are not read. No future dates.'],
    ...(kind === 'combined'
      ? [['Type', 'Yes', 'Expense or Income. Debit and Credit also work.'] as [string, string, string]]
      : []),
    ['Description', 'Yes', 'What it was, in up to 200 characters.'],
    ['Amount', 'Yes', 'A positive number in rupees, like 1250 or 1250.50. ₹ and commas are fine. ' +
      'At most two decimal places, and up to 1,00,000 per entry.'],
    ['Category', 'No', 'One of the categories on the Lists sheet. Leave it blank for none.'],
    ['Account', kind === 'expense' ? 'No' : kind === 'income' ? 'Yes' : 'For income',
      'The account\'s name exactly as on Cash & Accounts (see the Lists sheet). An expense with an account is ' +
      'taken out of it; leave it blank to only list the expense. Income is added to its account.'],
    ['Notes', 'No', 'Anything else, in up to 300 characters. Shown in the transaction\'s details.'],
    ['Payment Method', 'No', 'How it was paid: Cash, UPI, Card. If it is an account\'s name and Account is ' +
      'blank, that account is used.']
  ];

  return {
    name: 'Instructions',
    widths: [18, 12, 90],
    rows: [
      [text(`How to fill in this file`, 'title')],
      [text('')],
      [text(`1. Put one of your ${what} on each row of the Transactions sheet, under the headings. Keep the headings as they are.`, 'wrap')],
      [text('2. Replace the example rows with your own. If you leave them in, the import spots and leaves them out unless you choose to keep them.', 'wrap')],
      [text('3. In the app, open Transactions, choose Import, then Import Excel. Nothing is added until you have checked the preview and confirmed.', 'wrap')],
      [text('')],
      [text('Column', 'header'), text('Required', 'header'), text('What to write', 'header')],
      ...guide.map(([column, required, help]) => [text(column, 'bold'), text(required), text(help, 'wrap')]),
      [text('')],
      [text('Duplicates', 'bold'), text(''), text('A row with the same date, amount and description as an entry already in Transactions is marked as a duplicate and left out unless you keep it.', 'wrap')],
      [text('Not imported', 'bold'), text(''), text('Split bills and repayments of them. Add those from Add Expense and Add Income.', 'wrap')],
      [text('Size', 'bold'), text(''), text('Up to 2,000 rows and 5 MB per file.', 'wrap')]
    ]
  };
}
