/**
 * Turning rows into a CSV file the browser downloads.
 *
 * Shared by the expenses page, which exports what is on screen, and the profile
 * page, which exports everything — so the two cannot disagree about quoting.
 */

/** Excel only reads a CSV as UTF-8 when it starts with a byte-order mark. */
const BOM = '﻿';

/** CSV's own line ending, which Excel is least likely to argue with. */
const CRLF = '\r\n';

/** The characters that force a cell to be quoted: comma, quote, CR, LF. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * The characters a spreadsheet treats as the start of a formula rather than
 * text. Tab and carriage return count because Excel strips them first.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Quotes a value for CSV.
 *
 * A description is free text, so it can contain the delimiter, a quote or a
 * newline; each would otherwise shift every later column of that row.
 *
 * A cell starting with = + - or @ is also made inert with a leading
 * apostrophe, which spreadsheets strip on display. Without it, a description
 * reading `=HYPERLINK("http://…")` is not data in the exported file — it is a
 * formula that Excel runs when the file is opened, and descriptions can arrive
 * over WhatsApp from whoever has the linked number.
 */
export function toCsvCell(value: string): string {
  const text = String(value ?? '');
  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text;

  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Joins a header row and body rows into one CSV document. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map(row => row.map(toCsvCell).join(',')).join(CRLF);
}

/**
 * Hands the file to the browser.
 *
 * The anchor is never added to the document — clicking a detached one is enough
 * to start the download, and leaves nothing behind to clean up.
 */
export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const blob = new Blob([BOM + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
