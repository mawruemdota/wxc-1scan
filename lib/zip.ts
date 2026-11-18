/** Minimal ZIP (stored files) writer for already-compressed QR PNGs. No third-party dependency. */
export type ZipEntry = { name: string; data: Uint8Array };

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipFiles(entries: ZipEntry[]): Uint8Array {
  if (entries.length > 1000) throw new Error('Too many QR images in one ZIP.');
  const encoder = new TextEncoder();
  const files = entries.map(entry => {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(entry.name)) throw new Error('Unsafe ZIP filename.');
    const name = encoder.encode(entry.name);
    return { name, data: entry.data, crc: crc32(entry.data) };
  });
  const localSize = files.reduce((sum, item) => sum + 30 + item.name.length + item.data.length, 0);
  const centralSize = files.reduce((sum, item) => sum + 46 + item.name.length, 0);
  if (localSize + centralSize + 22 > 150 * 1024 * 1024) throw new Error('The QR ZIP exceeds 150 MB.');
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  let centralOffset = localSize;
  const u16 = (at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (at: number, value: number) => view.setUint32(at, value, true);
  for (const file of files) {
    const localAt = offset;
    u32(offset, 0x04034b50);
    u16(offset + 4, 20); // ZIP 2.0
    u16(offset + 6, 0);  // no flags; filenames are ASCII
    u16(offset + 8, 0);  // stored: PNG already compressed
    u16(offset + 10, 0);
    u16(offset + 12, 0x0021); // Jan 1, 1980
    u32(offset + 14, file.crc);
    u32(offset + 18, file.data.length);
    u32(offset + 22, file.data.length);
    u16(offset + 26, file.name.length);
    u16(offset + 28, 0);
    offset += 30;
    output.set(file.name, offset);
    offset += file.name.length;
    output.set(file.data, offset);
    offset += file.data.length;

    u32(centralOffset, 0x02014b50);
    u16(centralOffset + 4, 20);
    u16(centralOffset + 6, 20);
    u16(centralOffset + 8, 0);
    u16(centralOffset + 10, 0);
    u16(centralOffset + 12, 0);
    u16(centralOffset + 14, 0x0021);
    u32(centralOffset + 16, file.crc);
    u32(centralOffset + 20, file.data.length);
    u32(centralOffset + 24, file.data.length);
    u16(centralOffset + 28, file.name.length);
    u16(centralOffset + 30, 0);
    u16(centralOffset + 32, 0);
    u16(centralOffset + 34, 0);
    u16(centralOffset + 36, 0);
    u32(centralOffset + 38, 0);
    u32(centralOffset + 42, localAt);
    centralOffset += 46;
    output.set(file.name, centralOffset);
    centralOffset += file.name.length;
  }
  u32(centralOffset, 0x06054b50);
  u16(centralOffset + 4, 0);
  u16(centralOffset + 6, 0);
  u16(centralOffset + 8, files.length);
  u16(centralOffset + 10, files.length);
  u32(centralOffset + 12, centralSize);
  u32(centralOffset + 16, localSize);
  u16(centralOffset + 20, 0);
  return output;
}
