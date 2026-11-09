import {
  dateLabel,
  daysBetween,
  occurrenceDate,
  previewDates,
  relativeDay,
  remindLabel,
  repeatLabel
} from './recurring.service';

describe('recurring date helpers', () => {
  it('agrees with the server on month ends: the 31st uses short months\' last day and comes back', () => {
    expect(previewDates('monthly', 1, '2027-01-31', null, 4))
      .toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('puts 29 February on 28 February in years without one', () => {
    expect(occurrenceDate('yearly', 1, '2028-02-29', 1)).toBe('2029-02-28');
    expect(occurrenceDate('yearly', 1, '2028-02-29', 4)).toBe('2032-02-29');
  });

  it('steps days and weeks across the year end', () => {
    expect(occurrenceDate('daily', 1, '2026-12-31', 1)).toBe('2027-01-01');
    expect(occurrenceDate('weekly', 2, '2026-12-25', 1)).toBe('2027-01-08');
  });

  it('stops the preview at the end date', () => {
    expect(previewDates('monthly', 1, '2026-11-05', '2026-12-05', 4)).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('describes how often it repeats in words', () => {
    expect(repeatLabel('daily', 1, '2026-11-06')).toBe('Every day');
    expect(repeatLabel('monthly', 1, '2027-01-31')).toBe('Monthly on the 31st');
    expect(repeatLabel('monthly', 1, '2026-11-02')).toBe('Monthly on the 2nd');
    expect(repeatLabel('monthly', 1, '2026-11-11')).toBe('Monthly on the 11th');
    expect(repeatLabel('monthly', 3, '2026-11-15')).toBe('Every 3 months on the 15th');
    expect(repeatLabel('weekly', 1, '2026-11-06')).toBe('Weekly on Friday');
    expect(repeatLabel('yearly', 1, '2026-11-03')).toContain('Yearly on 3');
  });

  it('labels days relative to today', () => {
    expect(relativeDay('2026-11-06', '2026-11-06')).toBe('Today');
    expect(relativeDay('2026-11-07', '2026-11-06')).toBe('Tomorrow');
    expect(relativeDay('2026-11-10', '2026-11-06')).toBe('in 4 days');
    expect(relativeDay('2026-11-03', '2026-11-06')).toBe('3 days ago');
    expect(daysBetween('2026-11-06', '2027-11-06')).toBe(365);
  });

  it('shows the year only when it is not this year', () => {
    expect(dateLabel('2026-11-10', '2026-11-06')).not.toContain('2026');
    expect(dateLabel('2027-01-31', '2026-11-06')).toContain('2027');
    expect(dateLabel(null, '2026-11-06')).toBe('—');
  });

  it('names the reminder choices', () => {
    expect(remindLabel(null)).toBe('Off');
    expect(remindLabel(1)).toBe('1 day before');
  });
});
