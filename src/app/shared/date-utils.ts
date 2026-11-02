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
