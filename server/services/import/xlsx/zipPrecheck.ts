/**
 * IMP-01 ZIP pre-check (owner decision N2). Runs before SheetJS or any XML
 * parser touches the upload, so a damaged or hostile archive is a clean 400.
 *
 * - The end record must close the file, and the central directory must sit
 *   exactly where and as large as it says.
 * - The local headers must tile the file from byte 0 to the central
 *   directory: no hidden entries, no gaps.
 * - Part names must be unique, ignoring case, as OPC part names are.
 * - Declared sizes, the entry count and the inflation ratio are checked
 *   before anything is inflated.
 * - Each local header must agree with its directory record: name, method,
 *   flags, CRC and sizes, and a data descriptor's CRC and sizes too.
 * - Every part is then inflated, capped at its declared size, and checked
 *   against its size and CRC-32. SheetJS reads an archive rebuilt from these
 *   verified parts (rebuildZip), never the upload itself.
 *
 * Nothing is written to disk.
 */
import { crc32, inflateRawSync } from "node:zlib";
import { ValidationError } from "../../../core/errors";
import { writeZip } from "../../../core/zipWriter";

export const XLSX_ZIP_LIMITS = {
  maxEntries: 1000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  /** Uncompressed/compressed ratio refused for entries above `ratioFloorBytes`. */
  maxRatio: 100,
  ratioFloorBytes: 1024 * 1024,
} as const;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const MAX_COMMENT_BYTES = 0xffff;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const refuse = (reason: string): never => {
  throw new ValidationError(`This Excel file cannot be imported: ${reason}`);
};

function readUInt(buffer: Buffer, offset: number, bytes: 2 | 4): number {
  if (offset < 0 || offset + bytes > buffer.length) refuse("the file is truncated or not a valid .xlsx");
  return bytes === 2 ? buffer.readUInt16LE(offset) : buffer.readUInt32LE(offset);
}

/** The end record: the last signature whose comment runs exactly to the end of the file. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_BYTES - MAX_COMMENT_BYTES);
  for (let offset = buffer.length - EOCD_BYTES; offset >= lowest; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    if (offset + EOCD_BYTES + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  return refuse("it is not a valid .xlsx (ZIP) file");
}

function checkDeclaredSize(entry: ZipEntry): void {
  if (entry.flags & FLAG_ENCRYPTED) refuse("password-protected files are not supported");
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) refuse("it uses an unsupported compression method");
  if (entry.compressedSize === ZIP64_MARKER_32 || entry.uncompressedSize === ZIP64_MARKER_32) refuse("ZIP64 archives are not supported");
  if (entry.uncompressedSize > XLSX_ZIP_LIMITS.maxEntryBytes) refuse("a part is too large when decompressed");
  if (entry.uncompressedSize > XLSX_ZIP_LIMITS.ratioFloorBytes &&
      entry.uncompressedSize > entry.compressedSize * XLSX_ZIP_LIMITS.maxRatio) {
    refuse("a part decompresses to far more than its stored size");
  }
}

/** The central directory, validated end to end; nothing is inflated here. */
function readCentralDirectory(buffer: Buffer): { entries: ZipEntry[]; directoryOffset: number } {
  if (buffer.length < EOCD_BYTES) refuse("it is not a valid .xlsx (ZIP) file");
  const eocd = findEndOfCentralDirectory(buffer);
  if (readUInt(buffer, eocd + 4, 2) !== 0 || readUInt(buffer, eocd + 6, 2) !== 0) refuse("split archives are not supported");
  const count = readUInt(buffer, eocd + 10, 2);
  const directorySize = readUInt(buffer, eocd + 12, 4);
  const directoryOffset = readUInt(buffer, eocd + 16, 4);
  if (count === ZIP64_MARKER_16 || directoryOffset === ZIP64_MARKER_32) refuse("ZIP64 archives are not supported");
  if (readUInt(buffer, eocd + 8, 2) !== count) refuse("its directory is corrupt");
  if (count > XLSX_ZIP_LIMITS.maxEntries) refuse("it contains too many parts");
  if (directoryOffset + directorySize !== eocd) refuse("its central directory is not where or as large as it declares");

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (readUInt(buffer, cursor, 4) !== CENTRAL_SIGNATURE) refuse("its directory is corrupt");
    const nameLength = readUInt(buffer, cursor + 28, 2);
    if (readUInt(buffer, cursor + 34, 2) !== 0) refuse("split archives are not supported");
    if (cursor + CENTRAL_HEADER_BYTES + nameLength > eocd) refuse("its directory is corrupt");
    const entry: ZipEntry = {
      flags: readUInt(buffer, cursor + 8, 2),
      method: readUInt(buffer, cursor + 10, 2),
      crc32: readUInt(buffer, cursor + 16, 4),
      compressedSize: readUInt(buffer, cursor + 20, 4),
      uncompressedSize: readUInt(buffer, cursor + 24, 4),
      localHeaderOffset: readUInt(buffer, cursor + 42, 4),
      name: buffer.toString("utf8", cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + nameLength),
    };
    checkDeclaredSize(entry);
    const key = entry.name.toLowerCase();
    if (seen.has(key)) refuse(`the part ${entry.name.slice(0, 80)} appears twice`);
    seen.add(key);
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > XLSX_ZIP_LIMITS.maxTotalBytes) refuse("it is too large when decompressed");
    entries.push(entry);
    cursor += CENTRAL_HEADER_BYTES + nameLength + readUInt(buffer, cursor + 30, 2) + readUInt(buffer, cursor + 32, 2);
  }
  if (cursor !== eocd) refuse("its central directory is not where or as large as it declares");
  return { entries, directoryOffset };
}

const DISAGREES = "a part header disagrees with the directory";

/** CRC-32 and both sizes, as three 32-bit fields from `offset`, equal the directory's. */
function sameIntegrity(buffer: Buffer, offset: number, entry: ZipEntry): boolean {
  return readUInt(buffer, offset, 4) === entry.crc32 &&
    readUInt(buffer, offset + 4, 4) === entry.compressedSize &&
    readUInt(buffer, offset + 8, 4) === entry.uncompressedSize;
}

/**
 * Where an entry's stored bytes start, after checking its local header agrees
 * with the directory: name, method and flags (review r6 P1), and the CRC and
 * sizes unless a data descriptor carries them, in which case the local fields
 * must be zero or the directory's.
 */
function localDataStart(buffer: Buffer, entry: ZipEntry): number {
  const local = entry.localHeaderOffset;
  if (readUInt(buffer, local, 4) !== LOCAL_SIGNATURE) refuse("a part header is corrupt");
  const nameLength = readUInt(buffer, local + 26, 2);
  const start = local + LOCAL_HEADER_BYTES + nameLength + readUInt(buffer, local + 28, 2);
  if (start > buffer.length) refuse("the file is truncated");
  const sameName = buffer.toString("utf8", local + LOCAL_HEADER_BYTES, local + LOCAL_HEADER_BYTES + nameLength) === entry.name;
  const sameMethod = readUInt(buffer, local + 8, 2) === entry.method;
  const sameFlags = readUInt(buffer, local + 6, 2) === entry.flags;
  const deferred = (entry.flags & FLAG_DATA_DESCRIPTOR) !== 0;
  const zeroed = readUInt(buffer, local + 14, 4) === 0 && readUInt(buffer, local + 18, 4) === 0 && readUInt(buffer, local + 22, 4) === 0;
  const sameSizes = sameIntegrity(buffer, local + 14, entry) || (deferred && zeroed);
  if (!sameName || !sameMethod || !sameFlags || !sameSizes) refuse(DISAGREES);
  return start;
}

/**
 * End of an entry's stored bytes, including a trailing data descriptor when it
 * has one; the descriptor's CRC and sizes must be the directory's (review r6 P1).
 */
function localDataEnd(buffer: Buffer, entry: ZipEntry, start: number): number {
  const end = start + entry.compressedSize;
  if (end > buffer.length) refuse("the file is truncated");
  if ((entry.flags & FLAG_DATA_DESCRIPTOR) === 0) return end;
  const fields = readUInt(buffer, end, 4) === DESCRIPTOR_SIGNATURE ? end + 4 : end;
  if (!sameIntegrity(buffer, fields, entry)) refuse(DISAGREES);
  return fields + 12;
}

function inflateEntry(buffer: Buffer, entry: ZipEntry, start: number): Buffer {
  const data = buffer.subarray(start, start + entry.compressedSize);
  let output: Buffer;
  if (entry.method === METHOD_STORED) {
    output = Buffer.from(data);
  } else {
    try {
      output = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch {
      return refuse("a part is corrupt or larger than it declares");
    }
  }
  if (output.length !== entry.uncompressedSize) refuse("a part is larger or smaller than it declares");
  if (crc32(output) >>> 0 !== entry.crc32) refuse("a part fails its integrity check; the file may be damaged or altered");
  return output;
}

/**
 * Validate the whole archive and return every part, inflated and verified,
 * by name. Callers read XML from here, never from a second unzip.
 */
export function precheckZip(buffer: Buffer): Map<string, Buffer> {
  const { entries, directoryOffset } = readCentralDirectory(buffer);
  const parts = new Map<string, Buffer>();
  let expected = 0;
  for (const entry of [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset)) {
    if (entry.localHeaderOffset !== expected) refuse("it holds data outside its listed parts");
    const start = localDataStart(buffer, entry);
    expected = localDataEnd(buffer, entry, start);
    parts.set(entry.name, inflateEntry(buffer, entry, start));
  }
  if (expected !== directoryOffset) refuse("it holds data outside its listed parts");
  return parts;
}

/**
 * The verified parts as a fresh archive (stored, no data descriptors), so the
 * second reader (SheetJS) reads exactly the bytes this check verified, never
 * the upload's own headers (review r6 P1).
 */
export function rebuildZip(parts: ReadonlyMap<string, Buffer>): Buffer {
  return writeZip(Array.from(parts, ([name, data]) => ({ name, data })));
}
