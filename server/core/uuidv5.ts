import { createHash } from "node:crypto";

/**
 * RFC 4122 §4.3 name-based (SHA-1) UUID version 5.
 *
 * Deterministic: the same (name, namespace) pair always yields the same UUID.
 * Used to derive stable idempotency keys for records whose natural key is not a
 * UUID (e.g. `recurring:<ruleId>:<occurrenceDate>`), so a UNIQUE(uuid) column can
 * dedupe retried/overlapping writes without a distributed lock.
 *
 * Dependency-free (Node's crypto only) so it works identically in dev, test, CI
 * and prod.
 */

const UUID_HEX_LENGTH = 32;

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== UUID_HEX_LENGTH || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`Invalid namespace UUID: ${uuid}`);
  }
  return Buffer.from(hex, "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Compute the version-5 UUID for `name` within `namespace`.
 *
 * @param name - Arbitrary UTF-8 string (the deterministic input).
 * @param namespace - A valid UUID string used as the hashing namespace.
 * @returns A canonical lowercase UUID string.
 */
export function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  // Version 5 (name-based, SHA-1): high nibble of byte 6 -> 0101.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // RFC 4122 variant: top two bits of byte 8 -> 10.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}
