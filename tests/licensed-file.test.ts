import assert from 'node:assert/strict';
import { test } from 'node:test';
const { detectLicenseFile, declaredFileType, MAX_LICENSE_FILE_BYTES, readLicenseFile } = await import(
  new URL('../src/lib/licensed-file.ts', import.meta.url).href
) as typeof import('../src/lib/licensed-file');

test('les formats autorisés sont reconnus par signature et structure du conteneur', () => {
  assert.equal(detectLicenseFile(Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF\n')), 'application/pdf');
  assert.equal(detectLicenseFile(Buffer.from([0xff,0xd8,0xff,0xe0,0,5,5,5,1,2,3,0xff,0xd9])), 'image/jpeg');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7iV8AAAAASUVORK5CYII=', 'base64');
  assert.equal(detectLicenseFile(png), 'image/png');
  const wav = Buffer.alloc(44); wav.write('RIFF'); wav.writeUInt32LE(36,4); wav.write('WAVE',8);
  assert.equal(detectLicenseFile(wav), 'audio/wav');
  const mp4 = Buffer.alloc(24); mp4.writeUInt32BE(24); mp4.write('ftypisom',4);
  assert.equal(detectLicenseFile(mp4),'video/mp4');
  assert.equal(declaredFileType('audio/x-wav'),'audio/wav');
  assert.equal(detectLicenseFile(Buffer.from('Mon texte enregistré en PNG')) ,null);
  assert.equal(detectLicenseFile(Buffer.from('%PDF-1.4 sans fin')) ,null);
});

test('la lecture borne les flux sans Content-Length', async () => {
  const tooLarge = new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.enqueue(new Uint8Array(MAX_LICENSE_FILE_BYTES)); ctrl.enqueue(new Uint8Array(1)); ctrl.close(); } });
  await assert.rejects(readLicenseFile(tooLarge), RangeError);
  assert.equal(await readLicenseFile(null), null);
  const small = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('abc')); c.enqueue(Buffer.from('de')); c.close(); } });
  assert.equal((await readLicenseFile(small))?.toString(), 'abcde');
});
