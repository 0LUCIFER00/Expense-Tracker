/**
 * Receipt attachments: checking files, with no database or storage.
 *
 * The type is decided by the file's own bytes (its signature), never by the
 * name or the browser's claim. A file that starts like a JPEG, PNG, WebP or
 * PDF but is cut short (no end marker) is treated as corrupted.
 */
import { randomUUID } from 'node:crypto';

/** One file per request; Vercel caps a request at 4.5 MB. */
export const MAX_BYTES = 4 * 1024 * 1024;

export const MAX_PER_EXPENSE = 10;

export const NAME_MAX = 120;

export const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function startsWith(buf, bytes, offset = 0) {
  return buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
}

/** Whether `bytes` appear anywhere in the last `window` bytes. */
function endsNear(buf, bytes, window) {
  const from = Math.max(0, buf.length - window);
  return buf.indexOf(Buffer.from(bytes), from) !== -1;
}

/**
 * What the bytes are: a content type, or null when they are not a whole
 * JPEG, PNG, WebP or PDF.
 *
 * @returns { type } or { error }
 */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { error: 'The file is empty.' };
  }

  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    // End-of-image marker, allowing for a little padding after it.
    return endsNear(buf, [0xff, 0xd9], 64)
      ? { type: 'image/jpeg' }
      : { error: 'That JPEG looks damaged or incomplete.' };
  }

  if (startsWith(buf, PNG_SIGNATURE)) {
    return endsNear(buf, PNG_IEND, 64)
      ? { type: 'image/png' }
      : { error: 'That PNG looks damaged or incomplete.' };
  }

  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    // RIFF's own length field: the file size less the 8-byte header.
    const declared = buf.readUInt32LE(4) + 8;
    return declared === buf.length || declared === buf.length - 1
      ? { type: 'image/webp' }
      : { error: 'That WebP image looks damaged or incomplete.' };
  }

  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return endsNear(buf, [0x25, 0x25, 0x45, 0x4f, 0x46], 2048)
      ? { type: 'application/pdf' }
      : { error: 'That PDF looks damaged or incomplete.' };
  }

  return { error: 'Only JPG, PNG, WebP images and PDF files can be attached.' };
}

/**
 * A display name: no folders, no control or reserved characters, at most
 * NAME_MAX characters, and an extension matching what the file really is.
 */
export function cleanName(raw, type) {
  let name = '';

  try {
    name = decodeURIComponent(String(raw ?? ''));
  } catch {
    name = String(raw ?? '');
  }

  name = name
    .split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const ext = TYPES[type];
  const stem = name.replace(/\.[^.]*$/, '').replace(/^\.+/, '').trim() || 'receipt';

  return `${stem.slice(0, NAME_MAX - ext.length - 1)}.${ext}`;
}

/** The storage key: the server's own ids only, never anything the user typed. */
export function storageKey(userId, expenseId, type) {
  return `receipts/${userId}/${expenseId}/${randomUUID()}.${TYPES[type]}`;
}

/**
 * Checks an upload completely.
 *
 * @returns { value: { type, name, size } } or { error, status }
 */
export function checkUpload(buf, rawName) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { status: 400, error: 'Choose a file to attach.' };
  }

  if (buf.length > MAX_BYTES) {
    return { status: 413, error: 'Each file can be up to 4 MB.' };
  }

  const sniffed = sniff(buf);

  if (sniffed.error) {
    return { status: 415, error: sniffed.error };
  }

  return { value: { type: sniffed.type, name: cleanName(rawName, sniffed.type), size: buf.length } };
}
