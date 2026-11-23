/**
 * Which ObjectStore the app uses (OPS-001, D18).
 *
 * STORAGE_DRIVER selects the driver and defaults to "local": objects live on
 * local disk under STORAGE_LOCAL_DIR (default `<cwd>/private-objects`). That
 * is the single-instance option and works on a plain VM. Production on a
 * container host needs STORAGE_LOCAL_DIR on a persistent disk, or
 * STORAGE_DRIVER=s3 with the S3_* variables (core/storage/config.ts). The
 * production choice is the owner's (D18); this module only reads it.
 *
 * The local root may never sit inside `uploads/`, which `/uploads/*` serves.
 *
 * The app cannot tell a mounted volume from a container's own disk, so the
 * operator states it: an empty `.persistent-volume` file in the root, written
 * once on the mounted volume. In production, a local root without it logs a
 * boot warning (never a refusal); see docs/runbooks/deploy.md.
 *
 * @module core/storage/runtime
 */
import { access } from "node:fs/promises";
import * as path from "node:path";
import { StorageError, type ObjectStore } from "../storage";
import { logger } from "../../utils/logger";
import { parseStorageConfiguration, type S3StorageConfiguration } from "./config";
import { LocalDiskObjectStore } from "./local";
import { createS3ObjectStore } from "./s3";

export type ObjectStoreConfiguration =
  | { readonly driver: "local"; readonly root: string }
  | { readonly driver: "s3"; readonly s3: S3StorageConfiguration };

const LOCAL_VARIABLES = new Set(["STORAGE_DRIVER", "STORAGE_LOCAL_DIR"]);

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Pure: read the driver choice from `env`. Throws INVALID_INPUT for a mixed or unsafe configuration. */
export function resolveObjectStoreConfiguration(env: Record<string, string | undefined>, cwd = process.cwd()): ObjectStoreConfiguration {
  const driver = env.STORAGE_DRIVER?.trim() || "local";
  if (driver === "s3") {
    const s3 = parseStorageConfiguration(env);
    if (!s3) throw new StorageError("INVALID_INPUT");
    return { driver, s3 };
  }
  if (driver !== "local") throw new StorageError("INVALID_INPUT");
  const supplied = Object.keys(env).filter((key) => /^(STORAGE_|S3_)/.test(key) && env[key] !== undefined);
  if (supplied.some((key) => !LOCAL_VARIABLES.has(key))) throw new StorageError("INVALID_INPUT");
  const configured = env.STORAGE_LOCAL_DIR?.trim();
  const root = path.resolve(cwd, configured || "private-objects");
  if (isInside(root, path.resolve(cwd, "uploads"))) throw new StorageError("INVALID_INPUT");
  return { driver, root };
}

let current: ObjectStore | undefined;

/** The process-wide store, built on first use from process.env. */
export function getObjectStore(): ObjectStore {
  if (current) return current;
  const configuration = resolveObjectStoreConfiguration(process.env);
  current = configuration.driver === "s3" ? createS3ObjectStore(configuration.s3) : new LocalDiskObjectStore(configuration.root);
  return current;
}

export const PERSISTENT_VOLUME_MARKER = ".persistent-volume";

/** Boot: in production, warn when the local root has no operator marker. Never throws. */
export async function warnIfLocalRootNotPersistent(configuration: ObjectStoreConfiguration, nodeEnv = process.env.NODE_ENV): Promise<boolean> {
  if (configuration.driver !== "local" || nodeEnv !== "production") return true;
  const marked = await access(path.join(configuration.root, PERSISTENT_VOLUME_MARKER)).then(() => true, () => false);
  if (!marked) {
    logger.warn(`Uploads may not survive a redeploy: STORAGE_LOCAL_DIR has no ${PERSISTENT_VOLUME_MARKER} marker. Put it on a persistent volume and create the marker there (docs/runbooks/deploy.md)`,
      { root: configuration.root });
  }
  return marked;
}

/** Boot: log a clear operator error when uploads cannot be stored. Never throws. */
export async function checkObjectStoreAtBoot(): Promise<boolean> {
  try {
    await getObjectStore().probe();
    await warnIfLocalRootNotPersistent(resolveObjectStoreConfiguration(process.env));
    return true;
  } catch (error) {
    const code = error instanceof StorageError ? error.code : "UNKNOWN";
    logger.error("File uploads are unavailable: check STORAGE_DRIVER and STORAGE_LOCAL_DIR (or the S3_* variables)", { code });
    return false;
  }
}
