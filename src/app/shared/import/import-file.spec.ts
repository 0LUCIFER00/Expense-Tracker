import {
  MAX_ROWS,
  autoMap,
  buildRawRows,
  buildTable,
  cellText,
  checkFile,
  decodeText,
  isSampleRow,
  kindFromColumns,
  mappingProblem,
  normaliseHeader,
  parseCsv
} from './import-file';

describe('import-file', () => {
  describe('parseCsv', () => {
    it('reads quoted cells holding commas, quotes and line breaks', () => {
      const rows = parseCsv('Date,Description,Amount\r\n2026-11-05,"Lunch, with ""team""\nand guests",250\r\n');

      expect(rows).toEqual([
        ['Date', 'Description', 'Amount'],
        ['2026-11-05', 'Lunch, with "team"\nand guests', '250']
      ]);
    });

    it('drops a byte-order mark and reads semicolon and tab files', () => {
      expect(parseCsv('﻿Date;Amount\n05/11/2026;1250,50')).toEqual([['Date', 'Amount'], ['05/11/2026', '1250,50']]);
      expect(parseCsv('Date\tAmount\n2026-11-05\t20')).toEqual([['Date', 'Amount'], ['2026-11-05', '20']]);
    });

    it('keeps a last line with no line break', () => {
      expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    });
  });

  it('decodes UTF-8, and falls back to Windows-1252 for older Excel files', () => {
    expect(decodeText(new TextEncoder().encode('₹250'))).toBe('₹250');
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });

  describe('checkFile', () => {
    it('accepts a CSV or .xlsx of a sensible size', () => {
      expect(checkFile({ name: 'nov.csv', size: 100 }, 'csv')).toBeNull();
      expect(checkFile({ name: 'Nov.XLSX', size: 100 }, 'xlsx')).toBeNull();
    });

    it('refuses the wrong type, old .xls, empty and oversized files with a reason', () => {
      expect(checkFile({ name: 'nov.pdf', size: 100 }, 'csv')).toContain('not a CSV or .xlsx');
      expect(checkFile({ name: 'nov.xls', size: 100 }, 'xlsx')).toContain('old .xls');
      expect(checkFile({ name: 'nov.xlsx', size: 100 }, 'csv')).toContain('Choose Import Excel');
      expect(checkFile({ name: 'nov.csv', size: 0 }, 'csv')).toContain('empty');
      expect(checkFile({ name: 'nov.csv', size: 6 * 1024 * 1024 }, 'csv')).toContain('up to 5 MB');
    });
  });

  it('normalises headings: case, currency marks and punctuation', () => {
    expect(normaliseHeader('Amount (₹)')).toBe('amount');
    expect(normaliseHeader('Dr./Cr.')).toBe('dr cr');
    expect(normaliseHeader('  Payment   Method ')).toBe('payment method');
  });

  describe('buildTable', () => {
    it('finds the heading row below a title and skips blank rows', () => {
      const table = buildTable([
        ['HDFC statement'],
        [],
        ['Txn Date', 'Narration', 'Withdrawal Amt', 'Deposit Amt'],
        ['05/11/2026', 'Coffee', '120', ''],
        ['', '', '', ''],
        ['06/11/2026', 'Salary', '', '50000']
      ]);

      expect(table.headerRow).toBe(3);
      expect(table.rows.map(r => r.row)).toEqual([4, 6]);
    });

    it('treats the first row as headings when none are recognised', () => {
      const table = buildTable([['When', 'What', 'How much'], ['2026-11-05', 'Tea', '20']]);
      expect(table.headerRow).toBe(1);
      expect(table.headers).toEqual(['When', 'What', 'How much']);
    });

    it('refuses an empty file, headings with nothing under them, and too many rows', () => {
      expect(() => buildTable([])).toThrowError(/empty/);
      expect(() => buildTable([['Date', 'Amount', 'Description']])).toThrowError(/no transactions/);

      const many = [['Date', 'Description', 'Amount'], ...Array.from({ length: MAX_ROWS + 1 }, () => ['2026-11-05', 'x', '1'])];
      expect(() => buildTable(many)).toThrowError(/up to 2,000/);
    });
  });

  describe('autoMap', () => {
    it('matches the template headings in any order', () => {
      const map = autoMap(['Amount', 'Payment Method', 'Date', 'Type', 'Notes', 'Account', 'Category', 'Description']);

      expect(map).toEqual(jasmine.objectContaining({
        amount: 0, paymentMethod: 1, date: 2, type: 3, notes: 4, account: 5, category: 6, description: 7, debit: -1, credit: -1
      }));
      expect(mappingProblem(map)).toBeNull();
    });

    it("matches this app's own exports, so they can be imported back", () => {
      const all = autoMap(['Date', 'Type', 'Amount', 'Description', 'Category', 'Account', 'Status', 'Your Share', 'Pays Back']);
      expect(all.type).toBe(1);
      expect(mappingProblem(all)).toBeNull();

      const income = autoMap(['Date', 'Amount', 'Description', 'Where It Came From', 'Account', 'Pays Back']);
      expect(income.category).toBe(3);
    });

    it('matches bank statement headings with separate debit and credit columns', () => {
      const map = autoMap(['Txn Date', 'Narration', 'Withdrawal Amt', 'Deposit Amt']);
      expect(map.debit).toBe(2);
      expect(map.credit).toBe(3);
      expect(mappingProblem(map)).toBeNull();
      expect(kindFromColumns(map)).toBeTrue();
    });

    it('says what is missing, and refuses one column for two fields', () => {
      const map = autoMap(['Date', 'Amount']);
      expect(mappingProblem(map)).toContain('description');
      expect(mappingProblem({ ...map, description: 1 })).toContain('two fields');
    });
  });

  describe('buildRawRows', () => {
    it('reads each field from its column, whatever the order', () => {
      const table = buildTable([['Amount', 'Description', 'Date'], [250, 'Lunch', '2026-11-05']]);
      const [row] = buildRawRows(table, autoMap(table.headers));

      expect(row).toEqual(jasmine.objectContaining({ row: 2, date: '2026-11-05', description: 'Lunch', amount: '250', category: '' }));
    });

    it('turns debit and credit columns into a kind and an amount', () => {
      const table = buildTable([
        ['Date', 'Narration', 'Debit', 'Credit'],
        ['2026-11-05', 'Coffee', '120', '0.00'],
        ['2026-11-06', 'Salary', '', '50000'],
        ['2026-11-07', 'Odd', '10', '10']
      ]);
      const rows = buildRawRows(table, autoMap(table.headers));

      expect(rows.map(r => [r.type, r.amount])).toEqual([['Expense', '120'], ['Income', '50000'], ['both', '10']]);
    });
  });

  it('shows numbers without floating-point noise', () => {
    expect(cellText(12.300000000000001)).toBe('12.3');
    expect(cellText(null)).toBe('');
    expect(cellText('  x ')).toBe('x');
  });

  it('recognises the template example rows, and nothing else', () => {
    const base = { date: '', type: '', category: '', account: '', notes: '', paymentMethod: '' };

    expect(isSampleRow({ ...base, description: 'Electricity bill', amount: '1450.50' })).toBeTrue();
    expect(isSampleRow({ ...base, description: 'electricity BILL', amount: '₹1,450.5' })).toBeTrue();
    expect(isSampleRow({ ...base, description: 'Electricity bill', amount: '1450' })).toBeFalse();
    expect(isSampleRow({ ...base, description: 'Lunch', amount: '180' })).toBeFalse();
  });
});
