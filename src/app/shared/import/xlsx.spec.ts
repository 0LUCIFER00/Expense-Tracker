import { isDateFormat, isoToSerial, readXlsx, serialToIso, writeXlsx } from './xlsx';
import { ZipError, crc32, readZip, writeZip } from './zip';

const encode = (text: string) => new TextEncoder().encode(text);

/** Deflates with the browser's own CompressionStream, as Excel's ZIPs are deflated. */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A ZIP whose entries are deflated (method 8), built by hand like Excel's. */
async function deflatedZip(files: { name: string; text: string }[]): Promise<Uint8Array> {
  const stored = writeZip(files.map(f => ({ name: f.name, data: encode(f.text) })));
  const entries = await readZip(stored);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const packed = await deflateRaw(data);
    const nameBytes = encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(data), true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const c = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(data), true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    c.set(nameBytes, 46);

    parts.push(local, packed);
    central.push(c);
    offset += local.length + packed.length;
  }

  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  all.forEach(p => { out.set(p, at); at += p.length; });
  return out;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** The parts of a workbook as Excel writes them: shared strings and a date style. */
function excelLikeParts(sheetRows: string, sheets = '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>') {
  return [
    { name: '[Content_Types].xml', text: '<Types/>' },
    { name: 'xl/workbook.xml', text: `<workbook ${NS}><workbookPr/><sheets>${sheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', text: `<sst ${NS}><si><t>Date</t></si><si><t>Description</t></si><si><t>Amount</t></si><si><r><t>Lunch </t></r><r><t>out</t></r></si></sst>` },
    { name: 'xl/styles.xml', text: `<styleSheet ${NS}><numFmts><numFmt numFmtId="170" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="170"/><xf numFmtId="14"/><xf numFmtId="4"/></cellXfs></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet ${NS}><sheetData>${sheetRows}</sheetData></worksheet>` },
    { name: 'xl/worksheets/sheet2.xml', text: `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second</t></is></c></row></sheetData></worksheet>` }
  ];
}

describe('xlsx', () => {
  it('reads a deflated workbook: shared strings, rich text, date styles and numbers', async () => {
    const bytes = await deflatedZip(excelLikeParts(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" s="1"><v>46331</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" s="3"><v>1250.5</v></c></row>' +
      '<row r="4"><c r="A4" s="2"><v>46332</v></c><c r="C4"><v>12.300000000000001</v></c></row>'
    ));

    const sheet = await readXlsx(bytes);

    expect(sheet.name).toBe('Sheet1');
    expect(sheet.rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-11-05', 'Lunch out', 1250.5],
      [],
      ['2026-11-06', null, 12.3]
    ]);
  });

  it('prefers a sheet called Transactions, and skips hidden ones', async () => {
    const parts = excelLikeParts('<row r="1"><c r="A1" t="inlineStr"><is><t>First</t></is></c></row>',
      '<sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Transactions" sheetId="2" r:id="rId2"/>');
    expect((await readXlsx(writeZip(parts.map(p => ({ name: p.name, data: encode(p.text) }))))).name).toBe('Transactions');

    const hidden = excelLikeParts('<row r="1"><c r="A1" t="inlineStr"><is><t>First</t></is></c></row>',
      '<sheet name="Old" sheetId="1" r:id="rId1" state="hidden"/><sheet name="Now" sheetId="2" r:id="rId2"/>');
    expect((await readXlsx(writeZip(hidden.map(p => ({ name: p.name, data: encode(p.text) }))))).name).toBe('Now');
  });

  it('refuses old .xls and password-protected files, and things that are not workbooks', async () => {
    await expectAsync(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])))
      .toBeRejectedWithError(ZipError, /old \.xls file or has a password/);
    await expectAsync(readXlsx(encode('Date,Amount'))).toBeRejectedWithError(ZipError, /not an \.xlsx file/);
    await expectAsync(readXlsx(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toBeRejectedWithError(ZipError);
  });

  it('writes a workbook it can read back, with dates, amounts and text intact', async () => {
    const bytes = writeXlsx([{
      name: 'Transactions',
      freezeHeader: true,
      rows: [
        [{ value: 'Date', style: 'header' }, { value: 'Description', style: 'header' }, { value: 'Amount', style: 'header' }],
        [{ value: isoToSerial('2026-11-05'), style: 'date' }, { value: 'Tea & <biscuits>' }, { value: 45.5, style: 'money' }]
      ],
      lists: [{ cells: 'B2:B10', source: ['Expense', 'Income'] }]
    }]);

    const sheet = await readXlsx(bytes);

    expect(sheet.rows).toEqual([['Date', 'Description', 'Amount'], ['2026-11-05', 'Tea & <biscuits>', 45.5]]);
  });

  it('knows date formats from number formats', () => {
    expect(isDateFormat('dd/mm/yyyy')).toBeTrue();
    expect(isDateFormat('yyyy\\-mm\\-dd')).toBeTrue();
    expect(isDateFormat('#,##0.00')).toBeFalse();
    expect(isDateFormat('[$₹-4009]#,##0.00')).toBeFalse();
    expect(isDateFormat('0.00 "days"')).toBeFalse();
  });

  it('converts Excel serial days both ways, including the 1904 system', () => {
    expect(serialToIso(46331)).toBe('2026-11-05');
    expect(isoToSerial('2026-11-05')).toBe(46331);
    expect(serialToIso(44869, true)).toBe('2026-11-05');
  });

  it('checks a stored ZIP round trip and its CRC', async () => {
    const zip = writeZip([{ name: 'a.txt', data: encode('hello') }]);
    const files = await readZip(zip);

    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello');
    expect(crc32(encode('hello'))).toBe(0x3610a686);
  });
});
