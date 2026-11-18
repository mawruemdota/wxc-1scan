import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, normalizePassSearch, passFilter } from '../lib/admin-query.ts';
import { zipFiles } from '../lib/zip.ts';

const clock = '2026-11-18T08:00:00.000Z';

test('nested filters preserve both search and availability status', () => {
  const filter = passFilter('unused', 'alpha_one', clock);
  assert.match(filter, /^and\(or\(status\.eq\.unused,and\(status\.eq\.reserved,reserved_until\.lte\./);
  assert.match(filter, /claimed_username\.ilike\.\*alpha_one\*/);
  assert.equal(passFilter('reserved', '', clock), `and(status.eq.reserved,reserved_until.gt.${clock})`);
  assert.equal(passFilter('claimed', '42', clock)?.includes('id.eq.42'), true);
  assert.equal(passFilter('all', '', clock), null);
});

test('search removes query filter injection tokens', () => {
  assert.equal(normalizePassSearch(' alice,(status.eq.claimed)%* '), 'alicestatus.eq.claimed');
  assert.equal(normalizePassSearch('hello+there@example.com'), 'hello+there@example.com');
});

test('CSV values are quoted and formula-like cells neutralized', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('   @hidden'), '"\'   @hidden"');
  assert.equal(csvCell('Doe, "Jane"'), '"Doe, ""Jane"""');
  assert.equal(csvCell(null), '""');
});

test('ZIP contains two correct stored entries and a central directory', () => {
  const bytes = zipFiles([
    {name:'1scan-qr-pass-1.png',data:new Uint8Array([1,2,3])},
    {name:'1scan-qr-pass-2.png',data:new Uint8Array([4,5,6,7])}
  ]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(bytes.byteLength - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.byteLength - 12, true), 2);
  assert.throws(() => zipFiles([{name:'../../unsafe.txt',data:new Uint8Array()}]), /Unsafe/);
});
