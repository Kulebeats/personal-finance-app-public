/**
 * Test-only ZIP and CSV readers for the personal-data export (A-27). Written
 * independently of the export's writer: its own CRC-32 table, and every entry's
 * CRC and length checked in both the central and local headers, not just listed.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function testCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ArchiveEntry { name: string; data: Buffer; flags: number; time: number; date: number }

/** Every entry of a stored (uncompressed) ZIP, after verifying CRC and sizes. */
export function readStoredZip(archive: Buffer): Map<string, ArchiveEntry> {
  const eocd = archive.length - 22;
  if (eocd < 0 || archive.readUInt32LE(eocd) !== 0x06054b50) throw new Error("No end-of-central-directory record");
  const count = archive.readUInt16LE(eocd + 10);
  const directorySize = archive.readUInt32LE(eocd + 12);
  let cursor = archive.readUInt32LE(eocd + 16);
  if (cursor + directorySize !== eocd) throw new Error("Central directory does not end at the EOCD record");
  const entries = new Map<string, ArchiveEntry>();
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Bad central header ${i}`);
    const flags = archive.readUInt16LE(cursor + 8), method = archive.readUInt16LE(cursor + 10);
    const time = archive.readUInt16LE(cursor + 12), date = archive.readUInt16LE(cursor + 14);
    const crc = archive.readUInt32LE(cursor + 16), compressed = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24), nameLength = archive.readUInt16LE(cursor + 28);
    const extra = archive.readUInt16LE(cursor + 30), comment = archive.readUInt16LE(cursor + 32);
    const offset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("latin1");
    if (method !== 0 || compressed !== size) throw new Error(`${name}: not stored`);
    if (archive.readUInt32LE(offset) !== 0x04034b50) throw new Error(`${name}: bad local header`);
    const local = {
      flags: archive.readUInt16LE(offset + 6), method: archive.readUInt16LE(offset + 8),
      crc: archive.readUInt32LE(offset + 14), compressed: archive.readUInt32LE(offset + 18),
      size: archive.readUInt32LE(offset + 22), nameLength: archive.readUInt16LE(offset + 26),
      extra: archive.readUInt16LE(offset + 28),
    };
    const localName = archive.subarray(offset + 30, offset + 30 + local.nameLength).toString("latin1");
    if (localName !== name || local.flags !== flags || local.method !== 0 || local.crc !== crc ||
        local.compressed !== compressed || local.size !== size) throw new Error(`${name}: local and central headers differ`);
    const start = offset + 30 + local.nameLength + local.extra;
    const data = archive.subarray(start, start + size);
    if (data.length !== size) throw new Error(`${name}: truncated`);
    if (testCrc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    if (entries.has(name)) throw new Error(`${name}: duplicate entry`);
    entries.set(name, { name, data: Buffer.from(data), flags, time, date });
    cursor += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** RFC 4180 rows as header-keyed records. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}
