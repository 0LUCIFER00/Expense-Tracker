import { parseLocalDate, toIsoDate, today } from './date-utils';

describe('date-utils', () => {
  describe('parseLocalDate', () => {
    it('keeps the calendar day regardless of the local offset', () => {
      // new Date('2026-10-01') is UTC midnight, which reads back as
      // 30 September anywhere west of Greenwich.
      const date = parseLocalDate('2026-10-01');

      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(9);
      expect(date.getDate()).toBe(1);
    });

    it('ignores a time component', () => {
      const date = parseLocalDate('2026-03-15T22:30:00.000Z');

      expect(date.getMonth()).toBe(2);
      expect(date.getDate()).toBe(15);
    });

    it('passes a Date straight through', () => {
      const original = new Date(2026, 5, 2);
      expect(parseLocalDate(original)).toBe(original);
    });
  });

  describe('toIsoDate', () => {
    it('zero-pads month and day', () => {
      expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('uses the local calendar day, not UTC', () => {
      const lateEvening = new Date(2026, 11, 31, 23, 30);
      expect(toIsoDate(lateEvening)).toBe('2026-12-31');
    });

    it('round-trips with parseLocalDate', () => {
      expect(toIsoDate(parseLocalDate('2026-07-04'))).toBe('2026-07-04');
    });
  });

  it('today() is a well-formed date string', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today()).toBe(toIsoDate(new Date()));
  });
});
