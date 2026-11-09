/** Tiny but structurally whole files of each kind, and some that are not. */

export const jpeg = (bodyBytes = 32) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.alloc(bodyBytes, 0x11),
  Buffer.from([0xff, 0xd9])
]);

export const png = () => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 0x22),
  Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
]);

export const webp = () => {
  const body = Buffer.concat([Buffer.from('WEBPVP8 '), Buffer.alloc(20, 0x33)]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
};

export const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

/** A JPEG cut off before its end marker, as a failed download would leave it. */
export const truncatedJpeg = () => jpeg(64).subarray(0, 40);

export const truncatedPdf = () => Buffer.from('%PDF-1.4\n1 0 obj << /Type', 'latin1');

export const gif = () => Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');

/** An HTML page renamed to look like a photo. */
export const htmlAsJpeg = () => Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

export const exe = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
