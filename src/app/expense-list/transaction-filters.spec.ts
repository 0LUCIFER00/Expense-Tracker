import {
  EMPTY_FILTERS,
  NO_ACCOUNT,
  TransactionFilters,
  chipsFor,
  compile,
  dateRange,
  filterProblem,
  isIsoDate,
  isNarrowed,
  matchesFilters,
  matchesSearch,
  parsePaise,
  searchText,
  totalsOf,
  toggled,
  withoutChip
} from './transaction-filters';
import type { TransactionRow } from './expense-list.component';
import { Expense, Income } from '../shared/models';

function expenseRow(overrides: Partial<Expense> = {}, row: Partial<TransactionRow> = {}): TransactionRow {
  const expense = {
    id: 'e1', amount: 250, description: 'Team lunch', date: '2026-11-05', category: 'Food & Drink',
    sourceId: 'b1', sourceType: 'Bank Account', sourceCategory: 'HDFC Bank', expenseAccess: true,
    updatePermission: true, balanceUpdated: true, status: 'Done', remarks: 'Added and balance updated',
    isPendingApproval: false, createdAt: '2026-11-05T10:00:00Z', ...overrides
  } as Expense;

  return {
    key: `out:${expense.id}`, kind: 'out', date: expense.date, amount: Number(expense.amount),
    description: expense.description, category: expense.category ?? 'Uncategorised',
    account: expense.sourceCategory, status: expense.isPendingApproval ? 'Pending approval' : 'Completed',
    createdAt: expense.createdAt, expense, ...row
  };
}

function incomeRow(overrides: Partial<Income> = {}): TransactionRow {
  const income = {
    id: 'i1', amount: 50000, description: 'October salary', date: '2026-11-01', category: 'Salary',
    targetId: 'b1', targetType: 'Bank Account', targetCategory: 'HDFC Bank', balanceUpdated: true,
    createdAt: '2026-11-01T09:00:00Z', ...overrides
  } as Income;

  return {
    key: `in:${income.id}`, kind: 'in', date: income.date, amount: Number(income.amount),
    description: income.description, category: income.splitExpenseId ? 'Repayment' : income.category ?? 'Uncategorised',
    account: income.targetCategory, status: 'Completed', createdAt: income.createdAt, income
  };
}

const f = (overrides: Partial<TransactionFilters>): TransactionFilters => ({ ...EMPTY_FILTERS, ...overrides });
const passes = (row: TransactionRow, filters: Partial<TransactionFilters>, today = '2026-11-10') =>
  matchesFilters(row, compile(f(filters), today));

describe('transaction filters', () => {
  describe('date ranges', () => {
    it('covers today, this month, last month and this year, both ends included', () => {
      expect(dateRange('today', '2026-11-10')).toEqual({ start: '2026-11-10', end: '2026-11-10' });
      expect(dateRange('month', '2026-11-10')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
      expect(dateRange('lastMonth', '2026-11-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
      expect(dateRange('year', '2026-11-10')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
      expect(dateRange('all', '2026-11-10')).toEqual({ start: null, end: null });
    });

    it('runs a week Monday to Sunday, including from a Sunday', () => {
      // 10 Nov 2026 is a Tuesday; 15 Nov a Sunday.
      expect(dateRange('week', '2026-11-10')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
      expect(dateRange('week', '2026-11-15')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
      expect(dateRange('week', '2026-11-16')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    });

    it('handles month and year edges: January, February and leap years', () => {
      expect(dateRange('lastMonth', '2026-01-15')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
      expect(dateRange('month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
      expect(dateRange('lastMonth', '2026-03-31')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    });

    it('takes a custom range as typed, either end open', () => {
      expect(dateRange('custom', '2026-11-10', '2026-10-01', '2026-10-15')).toEqual({ start: '2026-10-01', end: '2026-10-15' });
      expect(dateRange('custom', '2026-11-10', '2026-10-01', '')).toEqual({ start: '2026-10-01', end: null });
      expect(dateRange('custom', '2026-11-10', 'nonsense', '2026-10-15')).toEqual({ start: null, end: '2026-10-15' });
    });

    it('includes both boundary days and nothing beyond', () => {
      const range = { period: 'custom' as const, from: '2026-11-05', to: '2026-11-06' };

      expect(passes(expenseRow({ date: '2026-11-05' }), range)).toBeTrue();
      expect(passes(expenseRow({ date: '2026-11-06' }), range)).toBeTrue();
      expect(passes(expenseRow({ date: '2026-11-04' }), range)).toBeFalse();
      expect(passes(expenseRow({ date: '2026-11-07' }), range)).toBeFalse();
    });

    it('knows a real date', () => {
      expect(isIsoDate('2028-02-29')).toBeTrue();
      expect(isIsoDate('2026-02-29')).toBeFalse();
      expect(isIsoDate('05/11/2026')).toBeFalse();
    });
  });

  describe('amounts', () => {
    it('reads rupees as typed into exact paise', () => {
      expect(parsePaise('250')).toBe(25000);
      expect(parsePaise('1,250.50')).toBe(125050);
      expect(parsePaise('₹ 99.9')).toBe(9990);
      expect(parsePaise('')).toBeNull();
      expect(parsePaise('12.345')).toBeNaN();
      expect(parsePaise('-5')).toBeNaN();
      expect(parsePaise('abc')).toBeNaN();
    });

    it('filters by minimum and maximum, both ends included', () => {
      const row = expenseRow({ amount: 1450.5 });

      expect(passes(row, { minAmount: '1450.50' })).toBeTrue();
      expect(passes(row, { minAmount: '1450.51' })).toBeFalse();
      expect(passes(row, { maxAmount: '1,450.50' })).toBeTrue();
      expect(passes(row, { maxAmount: '1450' })).toBeFalse();
      expect(passes(row, { minAmount: '1000', maxAmount: '2000' })).toBeTrue();
    });
  });

  describe('invalid input', () => {
    it('says why filters cannot be applied', () => {
      expect(filterProblem(f({ minAmount: 'lots' }))).toContain('minimum amount is not a number');
      expect(filterProblem(f({ maxAmount: '1.234' }))).toContain('maximum amount is not a number');
      expect(filterProblem(f({ minAmount: '500', maxAmount: '100' }))).toContain('more than the maximum');
      expect(filterProblem(f({ period: 'custom', from: '2026-11-10', to: '2026-11-01' }))).toContain('after the end date');
      expect(filterProblem(f({ period: 'custom', from: '2026-02-30' }))).toContain('not a real date');
      expect(filterProblem(f({ minAmount: '100', maxAmount: '500' }))).toBeNull();
    });
  });

  describe('search', () => {
    const imported = expenseRow({
      description: 'Groceries at DMart', amount: 1450.5, category: 'Groceries',
      imported: { fileName: 'november.csv', notes: 'Monthly stock-up', paymentMethod: 'UPI' }
    });
    const find = (row: TransactionRow, text: string) => matchesSearch(searchText(row), text);

    it('finds by description, partly and in any case', () => {
      expect(find(imported, 'dmart')).toBeTrue();
      expect(find(imported, 'GROC')).toBeTrue();
      expect(find(imported, 'big bazaar')).toBeFalse();
    });

    it('finds by amount, with or without ₹, commas and paise', () => {
      for (const text of ['1450.5', '1450.50', '1,450.50', '₹1,450', '1450']) {
        expect(find(imported, text)).withContext(text).toBeTrue();
      }
      expect(find(imported, '999')).toBeFalse();
    });

    it('finds by category, account, notes and payment method', () => {
      expect(find(imported, 'groceries')).toBeTrue();
      expect(find(imported, 'hdfc')).toBeTrue();
      expect(find(imported, 'stock-up')).toBeTrue();
      expect(find(imported, 'upi')).toBeTrue();
    });

    it('needs every word, in any order', () => {
      expect(find(imported, 'upi dmart')).toBeTrue();
      expect(find(imported, 'upi cash')).toBeFalse();
    });

    it('finds a split by your share as well as the whole', () => {
      const split = expenseRow({ amount: 1200, splitMembers: 4, personalShare: 300, splitShare: 300 });
      expect(find(split, '300')).toBeTrue();
      expect(find(split, '1,200')).toBeTrue();
    });

    it('finds a repayment by the split it pays back', () => {
      expect(find(incomeRow({ splitExpenseId: 'e9', splitDescription: 'Goa trip' }), 'goa')).toBeTrue();
    });
  });

  describe('each filter', () => {
    it('year and month, together or alone, and Older for before the last five years', () => {
      const at = (date: string) => expenseRow({ date }, { date });

      expect(passes(at('2026-11-05'), { year: 2026 })).toBeTrue();
      expect(passes(at('2025-11-05'), { year: 2026 })).toBeFalse();
      expect(passes(at('2024-03-09'), { month: 3 })).withContext('a month of any year').toBeTrue();
      expect(passes(at('2024-03-09'), { month: 4 })).toBeFalse();
      expect(passes(at('2024-03-09'), { year: 2024, month: 3 })).toBeTrue();
      expect(passes(at('2025-03-09'), { year: 2024, month: 3 })).toBeFalse();

      // Today 2026: the menu lists 2026–2022, so Older is 2021 and before.
      expect(passes(at('2021-12-31'), { year: -1 })).toBeTrue();
      expect(passes(at('2022-01-01'), { year: -1 })).toBeFalse();
    });

    it('year and month show as chips that each clear on their own', () => {
      const filters = f({ year: 2025, month: 2 });
      const chips = chipsFor(filters);

      expect(chips.map(c => c.label)).toEqual(['2025', 'February']);
      expect(chipsFor(f({ year: -1 }))[0].label).toBe('Older years');
      expect(withoutChip(filters, chips[0])).toEqual(f({ month: 2 }));
      expect(withoutChip(filters, chips[1])).toEqual(f({ year: 2025 }));
      expect(isNarrowed(f({ month: 7 }))).toBeTrue();
    });

    it('category', () => {
      expect(passes(expenseRow(), { categories: ['Food & Drink'] })).toBeTrue();
      expect(passes(expenseRow(), { categories: ['Travel'] })).toBeFalse();
    });

    it('status: approved and pending; income counts as approved', () => {
      const pending = expenseRow({ isPendingApproval: true, status: 'Pending / Waiting Admin' });

      expect(passes(pending, { statuses: ['pending'] })).toBeTrue();
      expect(passes(expenseRow(), { statuses: ['pending'] })).toBeFalse();
      expect(passes(pending, { statuses: ['approved'] })).toBeFalse();
      expect(passes(incomeRow(), { statuses: ['approved'] })).toBeTrue();
      expect(passes(incomeRow(), { statuses: ['pending'] })).toBeFalse();
      expect(passes(pending, { statuses: ['approved', 'pending'] })).toBeTrue();
    });

    it('account, including entries with none', () => {
      const listed = expenseRow({ sourceCategory: null }, { account: null });

      expect(passes(expenseRow(), { accounts: ['HDFC Bank'] })).toBeTrue();
      expect(passes(expenseRow(), { accounts: ['Cash'] })).toBeFalse();
      expect(passes(listed, { accounts: [NO_ACCOUNT] })).toBeTrue();
      expect(passes(expenseRow(), { accounts: [NO_ACCOUNT] })).toBeFalse();
    });

    it('payment method, including entries with none recorded', () => {
      const upi = expenseRow({ imported: { fileName: 'a.csv', notes: null, paymentMethod: 'UPI' } });

      expect(passes(upi, { paymentMethods: ['UPI'] })).toBeTrue();
      expect(passes(expenseRow(), { paymentMethods: ['UPI'] })).toBeFalse();
      expect(passes(expenseRow(), { paymentMethods: [NO_ACCOUNT] })).toBeTrue();
      expect(passes(upi, { paymentMethods: [NO_ACCOUNT] })).toBeFalse();
    });

    it('several values of one filter are "any of these"', () => {
      const lunch = expenseRow();
      const bus = expenseRow({ id: 'e2', category: 'Travel', sourceCategory: 'Cash' }, { category: 'Travel', account: 'Cash' });
      const shoes = expenseRow({ id: 'e3', category: 'Shopping' }, { category: 'Shopping' });

      const either = { categories: ['Food & Drink', 'Travel'] };
      expect([lunch, bus, shoes].filter(r => passes(r, either)).map(r => r.expense!.id)).toEqual(['e1', 'e2']);

      const accounts = { accounts: ['HDFC Bank', 'Cash'] };
      expect([lunch, bus, shoes].every(r => passes(r, accounts))).toBeTrue();
    });

    it('different filters must all hold, each "any of" its own values', () => {
      const bus = expenseRow({ id: 'e2', category: 'Travel', sourceCategory: 'Cash' }, { category: 'Travel', account: 'Cash' });
      const both = { categories: ['Food & Drink', 'Travel'], accounts: ['Cash'] };

      expect(passes(bus, both)).toBeTrue();
      expect(passes(expenseRow(), both)).toBeFalse();
    });

    it('toggles a value in or out of a list', () => {
      expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
      expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
    });

    it('everything together must hold', () => {
      const all = { period: 'month' as const, categories: ['Food & Drink'], statuses: ['approved' as const], accounts: ['HDFC Bank'], minAmount: '200', maxAmount: '300' };

      expect(passes(expenseRow(), all)).toBeTrue();
      expect(passes(expenseRow({ date: '2026-10-31' }), all)).toBeFalse();
      expect(passes(expenseRow({ amount: 301 }), all)).toBeFalse();
    });
  });

  describe('totals', () => {
    it('follow the dashboard: your share of settled spending, income without repayments, and the net', () => {
      const totals = totalsOf([
        expenseRow({ amount: 250 }),
        expenseRow({ id: 'e2', amount: 1200, splitMembers: 4, personalShare: 300, splitShare: 300 }),
        expenseRow({ id: 'e3', amount: 99, status: 'Pending / Waiting Admin', isPendingApproval: true }),
        incomeRow({ amount: 1000 }),
        incomeRow({ id: 'i2', amount: 300, splitExpenseId: 'e2' })
      ]);

      expect(totals).toEqual({ expensePaise: 55000, incomePaise: 100000, repaidPaise: 30000, netPaise: 45000 });
    });

    it('can be negative, and are exact in paise', () => {
      const totals = totalsOf([expenseRow({ amount: 0.1 }), expenseRow({ id: 'e2', amount: 0.2 })]);

      expect(totals.expensePaise).toBe(30);
      expect(totals.netPaise).toBe(-30);
    });

    it('are zero for no rows', () => {
      expect(totalsOf([])).toEqual({ expensePaise: 0, incomePaise: 0, repaidPaise: 0, netPaise: 0 });
    });
  });

  describe('chips', () => {
    it('one per active filter, worded plainly', () => {
      const chips = chipsFor(f({
        period: 'custom', from: '2026-10-01', to: '2026-10-31', categories: ['Travel', 'Food & Drink'], statuses: ['pending'],
        accounts: [NO_ACCOUNT], paymentMethods: ['UPI'], minAmount: '100', maxAmount: '2,500', search: ' cab '
      }));

      expect(chips.map(c => c.label)).toEqual([
        '1 Oct 2026 – 31 Oct 2026', 'Travel', 'Food & Drink', 'Pending', 'No account', 'UPI', 'At least ₹100', 'At most ₹2,500', '“cab”'
      ]);
    });

    it('none when nothing narrows the list', () => {
      expect(chipsFor(EMPTY_FILTERS)).toEqual([]);
      expect(isNarrowed(EMPTY_FILTERS)).toBeFalse();
      expect(isNarrowed(f({ period: 'month' }))).toBeTrue();
    });

    it('removing a chip takes off just that value; the range chip clears both dates', () => {
      const both = f({ period: 'custom', from: '2026-10-01', to: '2026-10-31', categories: ['Travel', 'Shopping'] });

      expect(withoutChip(both, { key: 'categories', value: 'Travel', label: 'Travel' }))
        .toEqual(f({ period: 'custom', from: '2026-10-01', to: '2026-10-31', categories: ['Shopping'] }));
      expect(withoutChip(both, 'range')).toEqual(f({ categories: ['Travel', 'Shopping'] }));
    });
  });
});
