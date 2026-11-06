import {
  alertLabel,
  currentMonthKey,
  daysLeft,
  isMonthKey,
  monthLabel,
  shiftMonthKey,
  statusWord
} from './budget.service';

describe('budget helpers', () => {
  it('names the current month by the device calendar', () => {
    expect(currentMonthKey(new Date(2026, 10, 6))).toBe('2026-11');
    expect(currentMonthKey(new Date(2026, 0, 31))).toBe('2026-01');
  });

  it('moves between months across year ends', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-11', 0)).toBe('2026-11');
  });

  it('accepts only real month keys from the URL', () => {
    expect(isMonthKey('2026-11')).toBeTrue();
    expect(isMonthKey('2026-13')).toBeFalse();
    expect(isMonthKey('november')).toBeFalse();
    expect(isMonthKey(null)).toBeFalse();
  });

  it('labels months', () => {
    expect(monthLabel('2026-11')).toContain('November');
    expect(monthLabel('2026-11')).toContain('2026');
    expect(monthLabel('2026-11', true)).toContain('Nov');
  });

  it('counts the days left, today included', () => {
    const today = new Date(2026, 10, 6);

    expect(daysLeft('2026-11', today)).toBe(25);
    expect(daysLeft('2026-10', today)).toBe(0, 'a past month has none');
    expect(daysLeft('2026-12', today)).toBe(31, 'a future month has all of them');
  });

  it('words a status so it is never told by colour alone', () => {
    expect(statusWord({ status: 'on-track', spent: 10, budget: 100 })).toBe('On track');
    expect(statusWord({ status: 'near', spent: 80, budget: 100 })).toBe('Near limit');
    expect(statusWord({ status: 'over', spent: 100, budget: 100 })).toBe('Reached');
    expect(statusWord({ status: 'over', spent: 117, budget: 100 })).toBe('Over');
  });

  it('labels alerts', () => {
    expect(alertLabel(50)).toBe('50% used');
    expect(alertLabel(100)).toBe('budget reached');
    expect(alertLabel(101)).toBe('over budget');
  });
});
