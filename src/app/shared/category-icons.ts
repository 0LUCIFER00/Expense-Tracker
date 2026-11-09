/**
 * A small line icon for each expense category and income source, drawn as one
 * SVG path on a 24×24 grid (stroked, not filled). Used by the chips on Add
 * Expense and Add Income and by the badge on a transaction's details.
 *
 * Anything not listed (a category added later, or none) gets the dots of
 * "Other", so a new name never shows a broken icon.
 */
const ICONS: Record<string, string> = {
  // Spending
  'Food & Drink': 'M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8zM16 10h2a2 2 0 0 1 0 4h-2M8 3v2M11 3v2',
  Groceries: 'M4 9h16l-2 10H6L4 9zM8 9l4-5 4 5',
  Travel: 'M3 11l18-8-6 18-3-7-9-3z',
  Shopping: 'M6 8h12l-1 12H7L6 8zM9 8a3 3 0 0 1 6 0',
  'Bills & Utilities': 'M13 3L5 14h6l-1 7 8-11h-6l1-7z',
  Health: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  Entertainment: 'M4 6h16v12H4zM10 9l5 3-5 3V9z',
  Education: 'M2 9l10-5 10 5-10 5-10-5zM6 11v5c3 2 9 2 12 0v-5',
  'Family & Gifts': 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13',

  // Money in
  Salary: 'M4 8h16v11H4zM9 8V5h6v3',
  Business: 'M4 20V10l8-5 8 5v10M9 20v-6h6v6',
  Refund: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4',
  Gift: 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13',
  Interest: 'M6 18L18 6M7 7h.01M17 17h.01',
  'Sold something': 'M3 12V3h9l9 9-9 9-9-9zM7.5 7.5h.01',
  Repayment: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4'
};

/* Three dots, drawn as small rings so they show at 16 px. */
const OTHER = 'M5 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2zM19 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2z';

export function categoryIcon(name: string | null | undefined): string {
  return (name && ICONS[name]) || OTHER;
}
