import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

// Next's image optimizer relies on this native runtime. Exercise the actual
// codecs after the security update, including decoding the resulting bytes.
for (const format of ['png', 'jpeg', 'webp', 'avif'] as const) {
  test(`the patched image runtime encodes and decodes ${format}`, async () => {
    const encoded = await sharp({
      create: { width: 8, height: 6, channels: 3, background: '#bc4c21' },
    }).resize(4, 3).toFormat(format).toBuffer();
    const decoded = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 4);
    assert.equal(decoded.info.height, 3);
    assert.equal(decoded.info.channels, 3);
    assert.equal(decoded.data.length, 36);
  });
}
