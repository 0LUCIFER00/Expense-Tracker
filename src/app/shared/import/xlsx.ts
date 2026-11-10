/**
 * Reading the cells of an .xlsx workbook, and writing a small one.
 *
 * The reader returns one sheet as rows of cells: text as strings, numbers as
 * numbers, and anything formatted as a date as YYYY-MM-DD, so a date typed into
 * Excel arrives the same as one typed as text. The writer produces the import
 * templates: inline strings, a few styles, frozen headings and drop-downs.
 */
import { ZipError, readZip, writeZip } from './zip';

export type Cell = string | number | null;

export interface SheetData {
  name: string;
  rows: Cell[][];
}

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function parseXml(bytes: Uint8Array | undefined, what: string): Document {
  if (!bytes) {
    throw new ZipError(`This .xlsx file has no ${what}.`);
  }

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');

  if (doc.getElementsByTagName('parsererror').length) {
    throw new ZipError('This .xlsx file is damaged.');
  }

  return doc;
}

/** Elements by local name, whatever prefix the file gives its namespace. */
function all(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', name));
}

function first(node: Element, name: string): Element | null {
  return node.getElementsByTagNameNS('*', name)[0] ?? null;
}

/** The text of a shared or inline string, skipping phonetic guides. */
function stringText(node: Element): string {
  return all(node, 't')
    .filter(t => t.parentElement?.localName !== 'rPh')
    .map(t => t.textContent ?? '')
    .join('');
}

/** Excel's built-in number formats that are dates or times. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** True for a custom format code that shows a date: d, m or y outside quotes and brackets. */
export function isDateFormat(code: string): boolean {
  // Quoted text, [colour/currency] sections and escaped characters are not codes.
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*]/g, '').replace(/[\\_*]./g, '');

  return /[dmy]/i.test(bare);
}

/** Which cell styles (by index) display a date. */
function dateStyles(styles: Document | null): Set<number> {
  const result = new Set<number>();

  if (!styles) {
    return result;
  }

  const custom = new Map<number, string>();

  for (const format of all(styles, 'numFmt')) {
    custom.set(Number(format.getAttribute('numFmtId')), format.getAttribute('formatCode') ?? '');
  }

  const cellXfs = all(styles, 'cellXfs')[0];

  if (!cellXfs) {
    return result;
  }

  Array.from(cellXfs.children).forEach((xf, index) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);

    if (DATE_FORMAT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) {
      result.add(index);
    }
  });

  return result;
}

/** An Excel serial day as YYYY-MM-DD. */
export function serialToIso(serial: number, date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);

  return new Date(base + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** "AB12" -> 27 (zero-based column). */
function columnIndex(ref: string): number {
  let index = 0;

  for (const char of ref.replace(/\d+$/, '')) {
    index = index * 26 + (char.toUpperCase().charCodeAt(0) - 64);
  }

  return index - 1;
}

/** Floating-point noise off a number Excel stored (12.300000000000001 -> 12.3). */
function tidyNumber(value: number): number {
  return Number(value.toPrecision(15));
}

/** The sheet to import: one called Transactions, else the first visible one that is not help. */
function pickSheet(sheets: { name: string; target: string; hidden: boolean }[]) {
  const visible = sheets.filter(sheet => !sheet.hidden);
  const pool = visible.length ? visible : sheets;

  return (
    pool.find(sheet => sheet.name.trim().toLowerCase() === 'transactions') ??
    pool.find(sheet => !/^(instructions|lists|help|read ?me)$/i.test(sheet.name.trim())) ??
    pool[0]
  );
}

/**
 * Reads the transactions sheet of an .xlsx file.
 *
 * @throws ZipError with a sentence fit to show, when the file cannot be read
 */
export async function readXlsx(bytes: Uint8Array): Promise<SheetData> {
  // An old .xls, or an .xlsx with a password, is a Compound File, not a ZIP.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new ZipError('This is an old .xls file or has a password. Save it as .xlsx without a password, or as CSV.');
  }

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ZipError('This is not an .xlsx file. Save it from Excel as .xlsx, or as CSV.');
  }

  const files = await readZip(bytes, name => name.startsWith('xl/') && name.endsWith('.xml') || name.endsWith('.rels'));
  const workbook = parseXml(files.get('xl/workbook.xml'), 'workbook');
  const rels = parseXml(files.get('xl/_rels/workbook.xml.rels'), 'sheet list');
  const date1904 = all(workbook, 'workbookPr').some(pr => /^(1|true)$/.test(pr.getAttribute('date1904') ?? ''));

  const targets = new Map(all(rels, 'Relationship').map(rel => [rel.getAttribute('Id'), rel.getAttribute('Target') ?? '']));
  const sheets = all(workbook, 'sheet').map(sheet => {
    const id = sheet.getAttribute('r:id') ??
      sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(id) ?? '';

    return {
      name: sheet.getAttribute('name') ?? 'Sheet',
      hidden: (sheet.getAttribute('state') ?? 'visible') !== 'visible',
      target: target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    };
  });

  if (!sheets.length) {
    throw new ZipError('This workbook has no sheets.');
  }

  const chosen = pickSheet(sheets);
  const sheet = parseXml(files.get(chosen.target), `sheet called ${chosen.name}`);
  const sharedDoc = files.get('xl/sharedStrings.xml') ? parseXml(files.get('xl/sharedStrings.xml'), 'text') : null;
  const shared = sharedDoc ? all(sharedDoc, 'si').map(stringText) : [];
  const styles = files.get('xl/styles.xml') ? parseXml(files.get('xl/styles.xml'), 'styles') : null;
  const asDate = dateStyles(styles);

  const rows: Cell[][] = [];

  for (const row of all(sheet, 'row')) {
    const rowIndex = Number(row.getAttribute('r') ?? rows.length + 1) - 1;

    if (rowIndex > 100_000) {
      break;
    }

    const cells: Cell[] = [];
    let nextColumn = 0;

    for (const cell of Array.from(row.children).filter(child => child.localName === 'c')) {
      const ref = cell.getAttribute('r');
      const column = ref ? columnIndex(ref) : nextColumn;
      nextColumn = column + 1;

      if (column > 200) {
        continue;
      }

      const type = cell.getAttribute('t') ?? 'n';
      const raw = first(cell, 'v')?.textContent ?? null;
      let value: Cell = null;

      if (type === 's') {
        value = raw === null ? null : shared[Number(raw)] ?? null;
      } else if (type === 'inlineStr') {
        const inline = first(cell, 'is');
        value = inline ? stringText(inline) : null;
      } else if (type === 'str' || type === 'e') {
        value = raw;
      } else if (type === 'b') {
        value = raw === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'd') {
        value = raw ? raw.slice(0, 10) : null;
      } else if (raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw))) {
        const number = tidyNumber(Number(raw));
        value = asDate.has(Number(cell.getAttribute('s') ?? 0)) ? serialToIso(number, date1904) : number;
      }

      cells[column] = value;
    }

    rows[rowIndex] = Array.from(cells, cell => cell ?? null);
  }

  return { name: chosen.name, rows: Array.from(rows, row => row ?? []) };
}

// ---------------------------------------------------------------- writing

export type CellStyle = 'header' | 'date' | 'money' | 'title' | 'wrap' | 'bold';

export interface WriteCell {
  value: string | number | null;
  style?: CellStyle;
}

export interface WriteSheet {
  name: string;
  rows: WriteCell[][];
  /** Column widths in characters, left to right. */
  widths?: number[];
  /** Keep the first row in view while scrolling. */
  freezeHeader?: boolean;
  /** Drop-down lists: the cells, and either a range ("Lists!$A$2:$A$11") or the choices. */
  lists?: { cells: string; source: string | string[] }[];
}

const STYLE_INDEX: Record<CellStyle, number> = { header: 1, date: 2, money: 3, title: 4, wrap: 5, bold: 6 };

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function columnName(index: number): string {
  let name = '';

  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }

  return name;
}

function sheetXml(sheet: WriteSheet): string {
  const views = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell.value === null || cell.value === '') {
        return cell.style ? `<c r="${columnName(c)}${r + 1}" s="${STYLE_INDEX[cell.style]}"/>` : '';
      }

      const ref = `${columnName(c)}${r + 1}`;
      const style = cell.style ? ` s="${STYLE_INDEX[cell.style]}"` : '';

      return typeof cell.value === 'number'
        ? `<c r="${ref}"${style}><v>${cell.value}</v></c>`
        : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
    }).join('');

    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  const lists = sheet.lists?.length
    ? `<dataValidations count="${sheet.lists.length}">${sheet.lists.map(list => {
        const formula = Array.isArray(list.source) ? `"${list.source.join(',')}"` : list.source;

        return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" ` +
          `errorTitle="Not on the list" error="The import may not recognise this. Choose from the list, or check the Instructions sheet." ` +
          `sqref="${list.cells}"><formula1>${escapeXml(formula)}</formula1></dataValidation>`;
      }).join('')}</dataValidations>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${lists}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EAFF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** A workbook of `sheets`, as the bytes of an .xlsx file. */
export function writeXlsx(sheets: WriteSheet[]): Uint8Array {
  const encoder = new TextEncoder();
  const file = (name: string, text: string) => ({ name, data: encoder.encode(text) });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  return writeZip([
    file('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>'),
    file('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'),
    file('xl/workbook.xml', `${head}<workbook xmlns="${MAIN_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<bookViews><workbookView/></bookViews><sheets>' +
      sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>'),
    file('xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>'),
    file('xl/styles.xml', STYLES),
    ...sheets.map((sheet, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)))
  ]);
}

/** An Excel serial day for YYYY-MM-DD. */
export function isoToSerial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}
