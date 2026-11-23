import { createHash, randomUUID } from "node:crypto";

interface FixtureObject {
  bytes: Buffer;
  mediaType: string;
  sha256: string;
  versionId: string;
}

/** Single-version backing map for the owned synthetic S3 fixture. */
export function createOwnedS3Objects() {
  const id = randomUUID();
  let sequence = 0;
  let objects: Map<string, FixtureObject> | undefined = new Map();
  function active() {
    if (!objects) throw new Error("Owned S3 object map is retired");
    return objects;
  }

  return {
    id,
    get size() { return active().size; },
    entries() { return active().entries(); },
    get(key: string, versionId?: string) {
      const object = active().get(key);
      return versionId === undefined || versionId === object?.versionId ? object : undefined;
    },
    put(key: string, input: { bytes: Uint8Array; mediaType: string }) {
      const bytes = Buffer.from(input.bytes);
      const object = {
        bytes,
        mediaType: input.mediaType,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        versionId: id + "/" + (++sequence),
      };
      active().set(key, object);
      return object;
    },
    delete(key: string) { active().delete(key); },
    retire() {
      objects?.clear();
      objects = undefined;
    },
  };
}
