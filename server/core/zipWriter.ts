/**
 * The app's one ZIP writer (stored or deflated entries, no ZIP64), shared by
 * the .xlsx import template and archive rebuild (IMP-01) and the personal-data
 * export (A-27). Dependency-free.
 *
 * Only what the classic format can hold is written: every entry and the whole
 * archive below 4 GiB and at most 65,535 entries. Anything else throws
 * {@link ZipLimitError} before the archive is returned, so a caller never
 * writes a partial file. Entries carry a fixed timestamp (1980-01-01 00:00),
 * so the same parts always give the same bytes. The UTF-8 name flag is set only
 * on an entry whose name is not ASCII.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipPart {
  name: string;
  data: Buffer;
  /** Deflate the entry (default stored). */
  deflate?: boolean;
}

/** The archive cannot be represented without ZIP64; nothing was produced. */
export class ZipLimitError extends Error {
  constructor(readonly detail: string) {
    super(`ZIP limit exceeded: ${detail}`);
    this.name = "ZipLimitError";
  }
}

const DOS_DATE = 0x21;
const VERSION_NEEDED = 20;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_UTF8 = 0x800;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
/** 0xFFFFFFFF means "see ZIP64" in a classic header, so the largest usable value is one below. */
export const ZIP_MAX_BYTES = 0xfffffffe;
export const ZIP_MAX_ENTRIES = 0xffff;
const ZIP_MAX_NAME_BYTES = 0xffff;
const ASCII = /^[\x00-\x7f]*$/;

function header(size: number, fields: Array<[number, 2 | 4]>): Buffer {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  for (const [value, bytes] of fields) {
    if (bytes === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value, offset);
    offset += bytes;
  }
  return buffer;
}

function archiveSize(entries: readonly { name: Buffer; body: { length: number } }[]): number {
  return entries.reduce((total, entry) =>
    total + LOCAL_HEADER_SIZE + CENTRAL_HEADER_SIZE + 2 * entry.name.length + entry.body.length, END_RECORD_SIZE);
}

/** Sizes and counts that need no work are checked before any entry is read or deflated. */
function checkInputs(parts: readonly ZipPart[]): Buffer[] {
  if (parts.length > ZIP_MAX_ENTRIES) throw new ZipLimitError(`${parts.length} entries; at most ${ZIP_MAX_ENTRIES}`);
  const names = parts.map(part => {
    const name = Buffer.from(part.name, "utf8");
    if (name.length > ZIP_MAX_NAME_BYTES) throw new ZipLimitError(`an entry name is longer than ${ZIP_MAX_NAME_BYTES} bytes`);
    if (part.data.length > ZIP_MAX_BYTES) throw new ZipLimitError(`${part.name} is 4 GiB or larger`);
    return name;
  });
  if (archiveSize(parts.map((part, index) => ({ name: names[index], body: part.data }))) > ZIP_MAX_BYTES) {
    throw new ZipLimitError("the archive would be 4 GiB or larger");
  }
  return names;
}

export function writeZip(parts: readonly ZipPart[]): Buffer {
  const names = checkInputs(parts);
  const entries = parts.map((part, index) => ({
    part, name: names[index], body: part.deflate ? deflateRawSync(part.data) : part.data,
  }));
  // A deflated entry can come out larger than it went in.
  if (archiveSize(entries) > ZIP_MAX_BYTES) throw new ZipLimitError("the archive would be 4 GiB or larger");
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { part, name, body } of entries) {
    const method = part.deflate ? METHOD_DEFLATE : METHOD_STORED;
    const flags = ASCII.test(part.name) ? 0 : FLAG_UTF8;
    const crc = crc32(part.data) >>> 0;
    const common: Array<[number, 2 | 4]> = [[flags, 2], [method, 2], [0, 2], [DOS_DATE, 2], [crc, 4],
      [body.length, 4], [part.data.length, 4], [name.length, 2], [0, 2]];
    const local = Buffer.concat([header(LOCAL_HEADER_SIZE, [[0x04034b50, 4], [VERSION_NEEDED, 2], ...common]), name, body]);
    centrals.push(Buffer.concat([header(CENTRAL_HEADER_SIZE, [[0x02014b50, 4], [VERSION_NEEDED, 2], [VERSION_NEEDED, 2], ...common,
      [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), name]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = header(END_RECORD_SIZE, [[0x06054b50, 4], [0, 2], [0, 2], [parts.length, 2], [parts.length, 2],
    [directory.length, 4], [offset, 4], [0, 2]]);
  return Buffer.concat([...locals, directory, end]);
}
