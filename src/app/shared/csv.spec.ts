import { toCsv, toCsvCell } from './csv';

describe('toCsvCell', () => {
  it('leaves ordinary text alone', () => {
    expect(toCsvCell('Coffee')).toBe('Coffee');
    expect(toCsvCell('250')).toBe('250');
  });

  it('quotes a cell holding a comma, a quote or a newline', () => {
    expect(toCsvCell('Lunch, and coffee')).toBe('"Lunch, and coffee"');
    expect(toCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(toCsvCell('Two\nlines')).toBe('"Two\nlines"');
  });

  /*
   * A spreadsheet runs a cell starting with = + - or @ as a formula when the
   * file is opened. Descriptions are free text and can arrive over WhatsApp,
   * so one has to be made inert before it reaches the file.
   */
  it('defuses a cell a spreadsheet would run as a formula', () => {
    expect(toCsvCell('=1+1')).toBe("'=1+1");
    expect(toCsvCell('+1234567890')).toBe("'+1234567890");
    expect(toCsvCell('-5')).toBe("'-5");
    expect(toCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('defuses and quotes one that needs both', () => {
    expect(toCsvCell('=HYPERLINK("http://example.com","click")')).toBe(
      '"\'=HYPERLINK(""http://example.com"",""click"")"'
    );
  });

  it('treats null and undefined as empty', () => {
    expect(toCsvCell(null as unknown as string)).toBe('');
    expect(toCsvCell(undefined as unknown as string)).toBe('');
  });
});

describe('toCsv', () => {
  it('joins rows with CRLF and keeps the header first', () => {
    const csv = toCsv(['Date', 'Amount'], [['2026-11-03', '250']]);

    expect(csv).toBe('Date,Amount\r\n2026-11-03,250');
  });

  it('escapes every cell it is given, not only the first', () => {
    const csv = toCsv(['A', 'B'], [['ok', '=cmd']]);

    expect(csv).toBe("A,B\r\nok,'=cmd");
  });
});
