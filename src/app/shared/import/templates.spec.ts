import { autoMap, buildRawRows, buildTable, isSampleRow, mappingProblem, parseCsv } from './import-file';
import { templateCsv, templateCsvText, templateFileName, templateHeaders, templateXlsx } from './templates';
import { readXlsx } from './xlsx';
import { readZip } from './zip';

const context = {
  today: '2026-11-10',
  accounts: [{ name: 'HDFC Bank', type: 'Bank Account' }, { name: 'Wallet cash', type: 'Hand Cash' }],
  expenseCategories: ['Food & Drink', 'Groceries', 'Bills & Utilities', 'Other'],
  incomeCategories: ['Salary', 'Refund', 'Business', 'Other']
};

describe('import templates', () => {
  it('have the agreed headings; the combined one adds Type', () => {
    const base = ['Date', 'Description', 'Amount', 'Category', 'Account', 'Notes', 'Payment Method'];

    expect(templateHeaders('expense')).toEqual(base);
    expect(templateHeaders('income')).toEqual(base);
    expect(templateHeaders('combined')).toEqual(['Date', 'Type', ...base.slice(1)]);
  });

  it('carry two or three example rows, dated before today, with the person\'s own accounts', () => {
    for (const kind of ['expense', 'income', 'combined'] as const) {
      const { rows } = templateCsv(kind, context);

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.length).toBeLessThanOrEqual(3);
      expect(rows.every(row => row[0] < context.today)).toBeTrue();
    }

    const income = templateCsv('income', context).rows;
    expect(income.map(row => row[4])).toContain('HDFC Bank');
    expect(templateCsv('expense', context).rows[0][4]).toBe('Wallet cash');
  });

  it('use only categories the app has', () => {
    const all = [...context.expenseCategories, ...context.incomeCategories];
    const rows = templateCsv('combined', context).rows;

    expect(rows.map(row => row[1])).toEqual(['Income', 'Expense', 'Expense']);
    expect(rows.every(row => all.includes(row[4]))).toBeTrue();
  });

  it('fall back to placeholder account names when there are no accounts', () => {
    const rows = templateCsv('income', { ...context, accounts: [] }).rows;
    expect(rows[0][4]).toBe('Bank');
  });

  it('read straight back in, every column found, every example recognised as one', () => {
    for (const kind of ['expense', 'income', 'combined'] as const) {
      const table = buildTable(parseCsv(templateCsvText(kind, context)));
      const map = autoMap(table.headers);

      expect(mappingProblem(map)).toBeNull();
      expect(buildRawRows(table, map).every(isSampleRow)).withContext(kind).toBeTrue();
    }
  });

  it('are named for what they hold', () => {
    expect(templateFileName('combined', 'xlsx')).toBe('expense-and-income-import-template.xlsx');
    expect(templateFileName('expense', 'csv')).toBe('expense-import-template.csv');
  });

  describe('as Excel', () => {
    it('open on the Transactions sheet with real dates and amounts', async () => {
      const sheet = await readXlsx(templateXlsx('combined', context));

      expect(sheet.name).toBe('Transactions');
      expect(sheet.rows[0]).toEqual(templateHeaders('combined'));
      expect(sheet.rows[1][0]).toBe('2026-11-04');
      expect(sheet.rows[1][3]).toBe(45000);

      const table = buildTable(sheet.rows);
      expect(buildRawRows(table, autoMap(table.headers)).every(isSampleRow)).toBeTrue();
    });

    it('include an Instructions sheet explaining dates and amounts, and Lists for the drop-downs', async () => {
      const files = await readZip(templateXlsx('expense', context));
      const workbook = new TextDecoder().decode(files.get('xl/workbook.xml'));
      const instructions = new TextDecoder().decode(files.get('xl/worksheets/sheet2.xml'));
      const lists = new TextDecoder().decode(files.get('xl/worksheets/sheet3.xml'));
      const transactions = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));

      expect(workbook).toContain('name="Instructions"');
      expect(workbook).toContain('name="Lists"');
      expect(instructions).toContain('YYYY-MM-DD');
      expect(instructions).toContain('1250.50');
      expect(lists).toContain('Food &amp; Drink');
      expect(lists).toContain('HDFC Bank');
      expect(transactions).toContain('Lists!$A$2:$A$5');
      expect(transactions).toContain('state="frozen"');
    });
  });
});
