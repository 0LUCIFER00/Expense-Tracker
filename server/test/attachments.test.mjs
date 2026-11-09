/**
 * Receipt file checks, with no database or storage: the real type from the
 * bytes, damaged files, size, the display name and the storage key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, checkUpload, cleanName, sniff, storageKey } from '../src/attachments.mjs';
import * as files from './helpers/sample-files.mjs';

test('the type comes from the bytes: JPEG, PNG, WebP and PDF', () => {
  assert.equal(sniff(files.jpeg()).type, 'image/jpeg');
  assert.equal(sniff(files.png()).type, 'image/png');
  assert.equal(sniff(files.webp()).type, 'image/webp');
  assert.equal(sniff(files.pdf()).type, 'application/pdf');
});

test('damaged or cut-off files are refused', () => {
  assert.match(sniff(files.truncatedJpeg()).error, /JPEG looks damaged/);
  assert.match(sniff(files.truncatedPdf()).error, /PDF looks damaged/);
  assert.match(sniff(files.png().subarray(0, 20)).error, /PNG looks damaged/);
  assert.match(sniff(files.webp().subarray(0, 20)).error, /WebP image looks damaged/);
});

test('other types are refused whatever they are called', () => {
  for (const buf of [files.gif(), files.htmlAsJpeg(), files.exe(), Buffer.from('plain text')]) {
    assert.match(sniff(buf).error, /Only JPG, PNG, WebP images and PDF/);
  }
  assert.ok(sniff(Buffer.alloc(0)).error);
});

test('size: empty and over 4 MB are refused; exactly 4 MB is fine', () => {
  assert.equal(checkUpload(Buffer.alloc(0), 'a.jpg').status, 400);

  // 11 header bytes + body + 2-byte end marker = exactly MAX_BYTES.
  const big = files.jpeg(MAX_BYTES - 13);
  assert.equal(big.length, MAX_BYTES);
  assert.equal(checkUpload(big, 'big.jpg').value.size, MAX_BYTES);

  const tooBig = Buffer.concat([big, Buffer.from([0x00])]);
  assert.equal(checkUpload(tooBig, 'too-big.jpg').status, 413);
});

test('a file pretending to be a photo is refused (415)', () => {
  assert.equal(checkUpload(files.htmlAsJpeg(), 'receipt.jpg').status, 415);
});

test('display names: no folders, no control or reserved characters, the real extension', () => {
  assert.equal(cleanName('../../etc/passwd', 'application/pdf'), 'passwd.pdf');
  assert.equal(cleanName('C:\\Users\\me\\bill<1>.pdf', 'application/pdf'), 'bill1.pdf');
  assert.equal(cleanName('photo.exe', 'image/jpeg'), 'photo.jpg');
  assert.equal(cleanName('Swiggy%20order.png', 'image/png'), 'Swiggy order.png');
  assert.equal(cleanName('', 'image/webp'), 'receipt.webp');
  assert.equal(cleanName('.hidden', 'image/png'), 'receipt.png');
  assert.equal(cleanName('x'.repeat(500) + '.jpg', 'image/jpeg').length, 120);
  assert.equal(cleanName('tab\there\u0000.pdf', 'application/pdf'), 'tabhere.pdf');
});

test("storage keys are built from the server's ids only", () => {
  const key = storageKey('u1', 'e1', 'application/pdf');
  assert.match(key, /^receipts\/u1\/e1\/[0-9a-f-]{36}\.pdf$/);
  assert.notEqual(key, storageKey('u1', 'e1', 'application/pdf'));
});
