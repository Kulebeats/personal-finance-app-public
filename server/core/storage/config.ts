import { isIP } from "node:net";
import { StorageError } from "../storage";

export interface S3StorageConfiguration {
  readonly endpoint: string; readonly region: string; readonly bucket: string; readonly forcePathStyle: boolean;
  readonly credentials: { readonly accessKeyId: string; readonly secretAccessKey: string; readonly sessionToken?: string };
}
const variables = new Set(["STORAGE_DRIVER", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_SESSION_TOKEN", "S3_FORCE_PATH_STYLE"]);
/** Pure, explicit owner configuration; never discover ambient AWS credentials. */
export function parseStorageConfiguration(env: Record<string, string | undefined>): S3StorageConfiguration | undefined {
  const supplied = Object.keys(env).filter((key) => /^(STORAGE_|S3_)/.test(key) && env[key] !== undefined);
  if (!supplied.length) return undefined;
  if (supplied.some((key) => !variables.has(key)) || env.STORAGE_DRIVER !== "s3") throw new StorageError("INVALID_INPUT");
  const required = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  if (required.some((key) => !env[key]?.trim() || env[key]!.length > 4096 || /[\x00-\x1f\x7f]/.test(env[key]!))) throw new StorageError("INVALID_INPUT");
  let endpoint: URL;
  try { endpoint = new URL(env.S3_ENDPOINT!); } catch { throw new StorageError("INVALID_INPUT"); }
  if (env.S3_ENDPOINT !== env.S3_ENDPOINT!.trim() || /[?#]/.test(env.S3_ENDPOINT!) || endpoint.protocol !== "https:" || !endpoint.hostname || endpoint.port === "0" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") throw new StorageError("INVALID_INPUT");
  const bucket = env.S3_BUCKET!;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || /\.\.|\.-|-\./.test(bucket) || isIP(bucket) ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.S3_REGION!) ||
      (env.S3_FORCE_PATH_STYLE !== undefined && !["true", "false"].includes(env.S3_FORCE_PATH_STYLE)) ||
      (env.S3_SESSION_TOKEN !== undefined && (!env.S3_SESSION_TOKEN || /[\x00-\x1f\x7f]/.test(env.S3_SESSION_TOKEN) || env.S3_SESSION_TOKEN.length > 4096))) throw new StorageError("INVALID_INPUT");
  return Object.freeze({ endpoint: endpoint.origin, region: env.S3_REGION!, bucket,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true", credentials: Object.freeze({ accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      ...(env.S3_SESSION_TOKEN ? { sessionToken: env.S3_SESSION_TOKEN } : {}) }) });
}
