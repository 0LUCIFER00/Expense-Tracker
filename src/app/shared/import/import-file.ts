/**
 * Turning an imported file into rows the server can check.
 *
 * The browser only reads the file and works out which column is which. What a
 * cell means (is this a date, an amount, a known category?) is decided by the
 * server, the same way for the preview and the import.
 */
import type { Cell } from './xlsx';

export type { Cell };

/** The largest file accepted. A year of transactions as CSV is well under 1 MB. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Rows one import may hold; matches the server. */
export const MAX_ROWS = 2000;

/**
 * Rows sent per import request (the server takes up to 100). Smaller chunks
 * keep each request short and the progress bar moving.
 */
export const CHUNK_SIZE = 50;

export type FileKind = 'csv' | 'xlsx';

/** What can be mapped to a column. debit/credit are for statements with two amount columns. */
export type ImportField =
  | 'date' | 'description' | 'amount' | 'debit' | 'credit'
  | 'type' | 'category' | 'account' | 'notes' | 'paymentMethod';

export const FIELD_LABELS: Record<ImportField, string> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  debit: 'Money out (debit)',
  credit: 'Money in (credit)',
  type: 'Type (Expense / Income)',
  category: 'Category',
  account: 'Account',
  notes: 'Notes',
  paymentMethod: 'Payment Method'
};

export const FIELD_ORDER: ImportField[] = [
  'date', 'description', 'amount', 'type', 'category', 'account', 'notes', 'paymentMethod', 'debit', 'credit'
];

/** Column index for each field, or -1 when the file has no such column. */
export type ColumnMap = Record<ImportField, number>;

export type DefaultKind = 'expense' | 'income' | 'sign';

/** One row as sent to the server: raw cells, by field. */
export interface RawRow {
  row: number;
  date: string;
  description: string;
  amount: string;
  type: string;
  category: string;
  account: string;
  notes: string;
  paymentMethod: string;
  skip?: boolean;
  allowDuplicate?: boolean;
}

export type RawFields = Omit<RawRow, 'row' | 'skip' | 'allowDuplicate'>;

export interface ImportTable {
  /** The headings as written, one per column. */
  headers: string[];
  /** The row number (1-based, as a spreadsheet counts) the headings are on. */
  headerRow: number;
  /** The rows under the headings that have anything in them, with their row numbers. */
  rows: { row: number; cells: Cell[] }[];
}

export class ImportFileError extends Error {}

/** Every way people head the columns the app knows about. */
const SYNONYMS: Record<ImportField, string[]> = {
  date: ['date', 'transaction date', 'txn date', 'tran date', 'value date', 'posting date', 'posted date',
    'spent on', 'received on', 'day', 'date of transaction'],
  description: ['description', 'narration', 'details', 'particulars', 'transaction details', 'item',
    'title', 'merchant', 'payee', 'what', 'purpose', 'transaction description', 'name'],
  amount: ['amount', 'amount inr', 'amount rs', 'amt', 'value', 'total', 'sum', 'price', 'cost', 'inr', 'rs',
    'transaction amount'],
  debit: ['debit', 'debit amount', 'debit amt', 'withdrawal', 'withdrawals', 'withdrawal amt',
    'withdrawal amount', 'money out', 'paid out', 'dr', 'dr amount'],
  credit: ['credit', 'credit amount', 'credit amt', 'deposit', 'deposits', 'deposit amt', 'deposit amount',
    'money in', 'paid in', 'cr', 'cr amount'],
  type: ['type', 'transaction type', 'txn type', 'kind', 'dr cr', 'cr dr', 'debit credit', 'in out',
    'expense income', 'income expense'],
  category: ['category', 'categories', 'where it came from', 'head', 'expense category', 'income category',
    'category name', 'source of income'],
  account: ['account', 'account name', 'paid from', 'pay from', 'from account', 'to account', 'added to',
    'bank', 'wallet', 'bank account'],
  notes: ['notes', 'note', 'comment', 'comments', 'memo'],
  paymentMethod: ['payment method', 'payment mode', 'mode', 'method', 'paid via', 'paid by', 'payment type',
    'mode of payment']
};

/** "Amount (₹)" -> "amount", "Dr./Cr." -> "dr cr". */
export function normaliseHeader(text: Cell): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\((?:₹|rs\.?|inr)\)|₹/g, ' ')
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fieldFor(header: Cell): ImportField | null {
  const text = normaliseHeader(header);

  for (const field of FIELD_ORDER) {
    if (SYNONYMS[field].includes(text)) {
      return field;
    }
  }

  return null;
}

// ---------------------------------------------------------------- CSV

/**
 * RFC 4180 CSV: quoted cells may hold the delimiter, quotes ("") and line
 * breaks. The delimiter is whichever of comma, semicolon or tab the heading
 * line has most of, so a file saved by Excel in a comma-decimal locale reads too.
 */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.slice(0, body.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[i + 1] === '\n') {
        i += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** UTF-8 if it is valid UTF-8, otherwise Windows-1252, which older Excel writes. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---------------------------------------------------------------- the file

export function fileKindOf(name: string): FileKind | null {
  const lower = name.toLowerCase();

  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';

  return null;
}

/** Checks a chosen file before it is read: its type and size. */
export function checkFile(file: { name: string; size: number }, expected: FileKind): string | null {
  const kind = fileKindOf(file.name);

  if (file.name.toLowerCase().endsWith('.xls')) {
    return `${file.name} is an old .xls file. Save it as .xlsx or CSV and import that.`;
  }

  if (!kind) {
    return `${file.name} is not a CSV or .xlsx file.`;
  }

  if (kind !== expected) {
    return `${file.name} is ${kind === 'csv' ? 'a CSV' : 'an Excel'} file. Choose Import ${kind === 'csv' ? 'CSV' : 'Excel'} for it.`;
  }

  if (file.size === 0) {
    return `${file.name} is empty.`;
  }

  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; files up to 5 MB can be imported. Split it into smaller files.`;
  }

  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isBlank(cell: Cell): boolean {
  return cell === null || String(cell).trim() === '';
}

/**
 * Finds the heading row (the one among the first ten that names the most known
 * columns, else the first non-empty row) and the rows under it.
 *
 * @throws ImportFileError when there is nothing to import
 */
export function buildTable(grid: Cell[][]): ImportTable {
  let headerIndex = -1;
  let best = 0;

  for (let i = 0; i < Math.min(grid.length, 10); i += 1) {
    const score = new Set((grid[i] ?? []).map(fieldFor).filter(Boolean)).size;

    if (score > best) {
      best = score;
      headerIndex = i;
    }
  }

  if (best < 2) {
    headerIndex = grid.findIndex(row => (row ?? []).some(cell => !isBlank(cell)));
  }

  if (headerIndex < 0) {
    throw new ImportFileError('This file is empty.');
  }

  const width = Math.max(0, ...grid.map(row => (row ?? []).length));
  const headerCells = grid[headerIndex] ?? [];
  const headers = Array.from({ length: width }, (_, i) => String(headerCells[i] ?? '').trim());

  const rows = grid
    .slice(headerIndex + 1)
    .map((cells, i) => ({ row: headerIndex + 2 + i, cells: cells ?? [] }))
    .filter(entry => entry.cells.some(cell => !isBlank(cell)));

  if (!rows.length) {
    throw new ImportFileError('There are no transactions under the headings in this file.');
  }

  if (rows.length > MAX_ROWS) {
    throw new ImportFileError(
      `This file has ${rows.length.toLocaleString('en-IN')} transactions; up to ${MAX_ROWS.toLocaleString('en-IN')} ` +
      'can be imported at a time. Split it into smaller files.'
    );
  }

  return { headers, headerRow: headerIndex + 1, rows };
}

/** Which column each field is in, going by the headings. */
export function autoMap(headers: string[]): ColumnMap {
  const map = Object.fromEntries(FIELD_ORDER.map(field => [field, -1])) as ColumnMap;

  headers.forEach((header, index) => {
    const field = fieldFor(header);

    if (field && map[field] === -1) {
      map[field] = index;
    }
  });

  return map;
}

/** Why the columns cannot be used yet, or null when they can. */
export function mappingProblem(map: ColumnMap): string | null {
  if (map.date < 0) return 'Choose the column with the date.';
  if (map.description < 0) return 'Choose the column with the description.';
  if (map.amount < 0 && map.debit < 0 && map.credit < 0) return 'Choose the column with the amount.';

  const used = Object.values(map).filter(index => index >= 0);

  if (new Set(used).size !== used.length) {
    return 'One column is chosen for two fields. Each column can be used once.';
  }

  return null;
}

/** True when the file says per row whether it is money out or in. */
export function kindFromColumns(map: ColumnMap): boolean {
  return map.type >= 0 || (map.amount < 0 && (map.debit >= 0 || map.credit >= 0));
}

/** A cell as text, the way the server reads it. */
export function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) {
    return '';
  }

  return typeof cell === 'number' ? String(Number(cell.toPrecision(15))) : String(cell).trim();
}

/**
 * The rows as the server receives them. With separate debit and credit
 * columns, whichever has the amount says which kind the row is.
 */
export function buildRawRows(table: ImportTable, map: ColumnMap): RawRow[] {
  const at = (cells: Cell[], field: ImportField) => (map[field] >= 0 ? cellText(cells[map[field]]) : '');

  return table.rows.map(({ row, cells }) => {
    let amount = at(cells, 'amount');
    let type = at(cells, 'type');

    if (map.amount < 0) {
      const out = at(cells, 'debit').replace(/^[-−]/, '');
      const into = at(cells, 'credit').replace(/^[-−]/, '');
      const hasOut = out !== '' && !/^0+(\.0+)?$/.test(out);
      const hasIn = into !== '' && !/^0+(\.0+)?$/.test(into);

      amount = hasOut ? out : into;
      type = hasOut && hasIn ? 'both' : hasOut ? 'Expense' : hasIn ? 'Income' : '';
    }

    return {
      row,
      date: at(cells, 'date'),
      description: at(cells, 'description'),
      amount,
      type,
      category: at(cells, 'category'),
      account: at(cells, 'account'),
      notes: at(cells, 'notes'),
      paymentMethod: at(cells, 'paymentMethod')
    };
  });
}

/** The example rows the downloadable templates carry, by description and amount. */
export const SAMPLE_ROWS: { description: string; amount: number }[] = [
  { description: 'Lunch at office canteen', amount: 180 },
  { description: 'Electricity bill', amount: 1450.5 },
  { description: 'Weekly vegetables', amount: 620 },
  { description: 'Salary for October', amount: 45000 },
  { description: 'Refund for returned headphones', amount: 1299 },
  { description: 'Freelance logo design', amount: 3500 }
];

/** True for a row that is still one of the template's examples. */
export function isSampleRow(row: RawFields): boolean {
  const description = row.description.trim().toLowerCase();
  const amount = Number(row.amount.replace(/[₹,\s]/g, ''));

  return SAMPLE_ROWS.some(sample =>
    sample.description.toLowerCase() === description && Math.abs(sample.amount - amount) < 0.005);
}
