/**
 * `new Date('2026-10-01')` is parsed as UTC midnight, so west of Greenwich it
 * reads back as 30 September in local time. Dates in this app are calendar
 * days, not instants, so build them in local time instead.
 */
export function parseLocalDate(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);

  if (!year || !month || !day) {
    return new Date(value);
  }

  return new Date(year, month - 1, day);
}

/** Formats a Date as YYYY-MM-DD using its local calendar day. */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(): string {
  return toIsoDate(new Date());
}

export function yesterday(): string {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  return toIsoDate(day);
}

/** "Today, 9 Nov", "Yesterday, 8 Nov" or "12 Oct 2026". */
export function dayLabel(value: string): string {
  if (!value) {
    return '';
  }

  const date = parseLocalDate(value);
  const short = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  if (value === today()) {
    return `Today, ${short}`;
  }

  if (value === yesterday()) {
    return `Yesterday, ${short}`;
  }

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Opens the browser's own calendar for a (visually hidden) date field. */
export function openDatePicker(input: HTMLInputElement): void {
  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
}
