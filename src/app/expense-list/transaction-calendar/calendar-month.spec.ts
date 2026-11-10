import { daysInMonth, highSpendDays, monthGrid, monthLabel, monthOf, shiftMonth, summariseDays } from './calendar-month';
import { todayInIndia } from '../../shared/date-utils';
import type { TransactionRow } from '../expense-list.component';
import { Expense, Income } from '../../shared/models';
import { totalsOf } from '../transaction-filters';

function spent(date: string, amount: number, extra: Partial<Expense> = {}): TransactionRow {
  const expense = {
    id: `${date}-${amount}`, amount, description: 'x', date, category: 'Food & Drink', sourceCategory: 'HDFC Bank',
    status: 'Done', isPendingApproval: false, createdAt: `${date}T10:00:00Z`, ...extra
  } as Expense;
  return { key: `out:${expense.id}`, kind: 'out', date, amount, description: 'x', category: 'Food & Drink',
    account: 'HDFC Bank', status: 'Completed', createdAt: expense.createdAt, expense };
}

function came(date: string, amount: number, extra: Partial<Income> = {}): TransactionRow {
  const income = { id: `${date}-in-${amount}`, amount, description: 'y', date, category: 'Salary',
    targetCategory: 'HDFC Bank', createdAt: `${date}T09:00:00Z`, ...extra } as Income;
  return { key: `in:${income.id}`, kind: 'in', date, amount, description: 'y', category: 'Salary',
    account: 'HDFC Bank', status: 'Completed', createdAt: income.createdAt, income };
}

describe('calendar month', () => {
  describe('months', () => {
    it('steps across year ends both ways', () => {
      expect(shiftMonth('2026-12', 1)).toBe('2027-01');
      expect(shiftMonth('2026-01', -1)).toBe('2025-12');
      expect(shiftMonth('2026-11', -13)).toBe('2025-10');
      expect(shiftMonth('2026-11', 0)).toBe('2026-11');
    });

    it('knows each month\'s length, February and leap years included', () => {
      expect(daysInMonth('2026-01')).toBe(31);
      expect(daysInMonth('2026-04')).toBe(30);
      expect(daysInMonth('2026-02')).toBe(28);
      expect(daysInMonth('2028-02')).toBe(29);
      expect(daysInMonth('2100-02')).toBe(28);
      expect(daysInMonth('2000-02')).toBe(29);
    });

    it('names the month', () => {
      expect(monthLabel('2026-11')).toBe('November 2026');
    });
  });

  describe('the grid, Monday first', () => {
    it('starts November 2026 (a Sunday on the 1st) with six days of October and fills six weeks', () => {
      const cells = monthGrid('2026-11');

      expect(cells.length).toBe(42);
      expect(cells.slice(0, 6).map(c => c.iso)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
      expect(cells.slice(0, 6).every(c => !c.inMonth)).toBeTrue();
      expect(cells[6]).toEqual({ iso: '2026-11-01', day: 1, inMonth: true });
      expect(cells[35]).toEqual({ iso: '2026-11-30', day: 30, inMonth: true });
      expect(cells[36].iso).toBe('2026-12-01');
      expect(cells.filter(c => c.inMonth).length).toBe(30);
    });

    it('puts every date under its own weekday', () => {
      for (const month of ['2026-02', '2026-11', '2027-02', '2028-02', '2026-03']) {
        monthGrid(month).forEach((cell, i) => {
          const [y, m, d] = cell.iso.split('-').map(Number);
          const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
          expect(weekday).withContext(`${month} ${cell.iso}`).toBe(i % 7);
        });
      }
    });

    it('uses exactly four weeks when a 28-day February starts on a Monday', () => {
      const cells = monthGrid('2027-02');
      expect(cells.length).toBe(28);
      expect(cells[0].iso).toBe('2027-02-01');
      expect(cells[27].iso).toBe('2027-02-28');
    });

    it('includes the 29th in a leap February', () => {
      const cells = monthGrid('2028-02').filter(c => c.inMonth);
      expect(cells.length).toBe(29);
      expect(cells[28].iso).toBe('2028-02-29');
    });
  });

  describe('days', () => {
    it('groups by the stored date and leaves out other months, edges included', () => {
      const days = summariseDays([
        spent('2026-10-31', 10), spent('2026-11-01', 20), spent('2026-11-30', 30), spent('2026-12-01', 40),
        spent('2026-11-01', 5)
      ], '2026-11');

      expect([...days.keys()].sort()).toEqual(['2026-11-01', '2026-11-30']);
      expect(days.get('2026-11-01')!.rows.length).toBe(2);
      expect(days.get('2026-11-01')!.totals.expensePaise).toBe(2500);
    });

    it('totals each day by the list\'s rules: your share of a split, no pending, repayments apart', () => {
      const day = '2026-11-09';
      const rows = [
        spent(day, 60),
        spent(day, 1200, { splitMembers: 4, personalShare: 300, splitShare: 300 }),
        spent(day, 99, { status: 'Pending / Waiting Admin', isPendingApproval: true }),
        came(day, 300, { splitExpenseId: 'dinner' }),
        came(day, 1000)
      ];
      const summary = summariseDays(rows, '2026-11').get(day)!;

      expect(summary.totals).toEqual({ expensePaise: 36000, incomePaise: 100000, repaidPaise: 30000, netPaise: 64000 });
      expect(summary.totals).withContext('the same function the list uses').toEqual(totalsOf(rows));
      expect(summary.rows.length).toBe(5);
    });
  });

  describe('high-spending days', () => {
    it('are those over twice the average spending day, days with no spending left out', () => {
      const days = summariseDays([
        spent('2026-11-01', 180), spent('2026-11-02', 1820), spent('2026-11-03', 349), spent('2026-11-05', 750),
        spent('2026-11-06', 4209), spent('2026-11-07', 60), spent('2026-11-08', 60), spent('2026-11-09', 360),
        spent('2026-11-10', 2060), came('2026-11-04', 45000)
      ], '2026-11');
      const high = highSpendDays(days);

      expect(high.averagePaise).toBe(109422);
      expect(high.thresholdPaise).toBe(218844);
      expect([...high.days]).toEqual(['2026-11-06']);
    });

    it('need at least three spending days to compare against', () => {
      const days = summariseDays([spent('2026-11-01', 10), spent('2026-11-02', 5000)], '2026-11');
      expect(highSpendDays(days).days.size).toBe(0);
    });

    it('are none when every day is alike', () => {
      const days = summariseDays(['01', '02', '03', '04'].map(d => spent(`2026-11-${d}`, 100)), '2026-11');
      expect(highSpendDays(days).days.size).toBe(0);
    });
  });

  describe('today in India', () => {
    it('is India\'s date whatever the device clock says', () => {
      // 19:00 UTC on the 9th is 00:30 on the 10th in India.
      expect(todayInIndia(new Date('2026-11-09T19:00:00Z'))).toBe('2026-11-10');
      expect(todayInIndia(new Date('2026-11-09T18:29:00Z'))).toBe('2026-11-09');
      expect(todayInIndia(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
      expect(monthOf(todayInIndia(new Date('2026-11-30T19:00:00Z')))).toBe('2026-12');
    });
  });
});
