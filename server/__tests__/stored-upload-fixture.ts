/**
 * Test helpers for uploads held in the ObjectStore (OPS-001). A stored value
 * (URL or uploads path) is looked up through the storage_objects manifest and
 * read straight from the store, bypassing the HTTP authorization the suites
 * test separately.
 */
import { eq, like } from "drizzle-orm";
import { storageObjects } from "@shared/schema";
import { db } from "../db";
import { getObjectStore } from "../core/storage/runtime";
import { removeUploadObject, uploadNameOf } from "../core/storage/upload-objects";
import { validateStorageKey } from "../core/storage";

export async function storedObjectRow(stored: string) {
  const name = uploadNameOf(stored);
  if (!name) return undefined;
  const [row] = await db.select().from(storageObjects).where(eq(storageObjects.uploadName, name));
  return row;
}

/** The stored bytes for `stored`, or null when no object holds it. */
export async function storedBytes(stored: string): Promise<Buffer | null> {
  const row = await storedObjectRow(stored);
  if (!row) return null;
  validateStorageKey(row.key);
  try {
    return Buffer.from((await getObjectStore().get(row.key)).bytes);
  } catch {
    return null;
  }
}

export async function isStored(stored: string): Promise<boolean> {
  return (await storedBytes(stored)) !== null;
}

/** Logical names stored under a prefix such as `banners/{householdId}/`. */
export async function storedNamesUnder(prefix: string): Promise<string[]> {
  const rows = await db.select({ name: storageObjects.uploadName }).from(storageObjects)
    .where(like(storageObjects.uploadName, `${prefix}%`));
  return rows.map((row) => row.name);
}

/** Remove whatever a test stored under `prefix` (objects and manifest rows). */
export async function removeStoredUnder(prefix: string): Promise<void> {
  for (const name of await storedNamesUnder(prefix)) await removeUploadObject(`uploads/${name}`);
}
