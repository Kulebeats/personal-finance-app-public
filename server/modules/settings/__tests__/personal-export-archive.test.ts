/**
 * A-27: the in-house stored ZIP writer. Read back with the test's own reader
 * (its own CRC-32 table; CRC and sizes checked in both headers).
 */
import { describe, expect, it } from "vitest";
import { ArchiveLimitError, ArchiveNameError, buildStoredZip } from "../settings.privacy-export.archive";
import { readStoredZip, testCrc32 } from "./personal-export-archive-reader";

const FOUR_GIB = 2 ** 32;
/** A stand-in for a buffer too large to allocate: limits are checked before any byte is read. */
const sized = (length: number) => ({ length }) as unknown as Buffer;

describe("buildStoredZip", () => {
  const entries = [
    { name: "personal-data.json", data: Buffer.from('{"a":"kwacha K1,000"}', "utf8") },
    { name: "csv/goals.csv", data: Buffer.from("id,name\n1,\"=1+1\"\n", "utf8") },
    { name: "csv/empty.csv", data: Buffer.alloc(0) },
  ];

  it("writes every entry stored, with matching CRC and sizes in both headers", () => {
    const archive = readStoredZip(buildStoredZip(entries));
    expect([...archive.keys()]).toEqual(entries.map(entry => entry.name));
    for (const entry of entries) {
      const stored = archive.get(entry.name)!;
      expect(Buffer.compare(stored.data, entry.data)).toBe(0);
      expect(testCrc32(stored.data)).toBe(testCrc32(entry.data));
      // No UTF-8 name flag and no data descriptor: names are ASCII.
      expect(stored.flags).toBe(0);
      // 1980-01-01 00:00:00 in MS-DOS form.
      expect({ date: stored.date, time: stored.time }).toEqual({ date: 0x0021, time: 0 });
    }
  });

  it("produces the same bytes, and so the same checksum, for the same content", () => {
    expect(Buffer.compare(buildStoredZip(entries), buildStoredZip(entries.map(entry => ({ ...entry, data: Buffer.from(entry.data) }))))).toBe(0);
  });

  it.each(["données.json", "/etc/passwd", "csv/../escape.csv", "csv//double.csv", "back\\slash.csv", ""])(
    "refuses the entry name %j", (name) => {
      expect(() => buildStoredZip([{ name, data: Buffer.from("x") }])).toThrow(ArchiveNameError);
    });

  it("refuses a duplicate entry name", () => {
    expect(() => buildStoredZip([entries[0], entries[0]])).toThrow(ArchiveNameError);
  });

  it("refuses more than 65,535 entries", () => {
    const many = Array.from({ length: 65_536 }, (_, index) => ({ name: `e${index}`, data: Buffer.alloc(0) }));
    expect(() => buildStoredZip(many)).toThrow(ArchiveLimitError);
    expect(() => buildStoredZip(many.slice(0, 65_535))).not.toThrow();
  });

  it("refuses an entry of 4 GiB or more, and an archive that would reach 4 GiB", () => {
    expect(() => buildStoredZip([{ name: "big.bin", data: sized(FOUR_GIB) }])).toThrow(ArchiveLimitError);
    expect(() => buildStoredZip([{ name: "big.bin", data: sized(FOUR_GIB - 1) }])).toThrow(ArchiveLimitError);
    expect(() => buildStoredZip([
      { name: "half-1.bin", data: sized(FOUR_GIB / 2) }, { name: "half-2.bin", data: sized(FOUR_GIB / 2) },
    ])).toThrow(/4 GiB/);
  });

  it("reports a size refusal as a clear 413, not a server error", () => {
    const refused = (() => {
      try { buildStoredZip([{ name: "big.bin", data: sized(FOUR_GIB) }]); } catch (error) { return error; }
      return null;
    })();
    expect(refused).toBeInstanceOf(ArchiveLimitError);
    expect(refused).toMatchObject({ statusCode: 413, code: "EXPORT_TOO_LARGE" });
  });
});
