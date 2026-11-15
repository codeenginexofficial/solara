import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDemTiff } from '../../src/data/adapters/demExport.ts';

function makeLittleEndianStripTiff(width, height, samples) {
  const entries = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, 1, 16],
    [259, 3, 1, 1],
    [273, 4, 1, 0],
    [279, 4, 1, samples.length * 2],
    [339, 3, 1, 2],
  ];
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataOffset = ifdOffset + ifdSize;
  const buffer = new ArrayBuffer(dataOffset + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach(([tag, type, count, value], index) => {
    const entry = ifdOffset + 2 + index * 12;
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, count, true);
    if (tag === 273) view.setUint32(entry + 8, dataOffset, true);
    else if (type === 3) view.setUint16(entry + 8, value, true);
    else view.setUint32(entry + 8, value, true);
  });
  samples.forEach((sample, index) => {
    view.setInt16(dataOffset + index * 2, sample, true);
  });
  return new Uint8Array(buffer);
}

test('decodes an uncompressed signed-16 strip TIFF', () => {
  const tiff = makeLittleEndianStripTiff(2, 2, [-100, 0, -32768, 1234]);
  const decoded = decodeDemTiff(tiff);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(Array.from(decoded.values), [-100, 0, -32768, 1234]);
});

test('rejects a non-TIFF payload with a typed error', () => {
  assert.throws(
    () => decodeDemTiff(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])),
    (error) => error?.code === 'dem-response-invalid',
  );
});
