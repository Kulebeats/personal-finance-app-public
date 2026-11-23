import { createHash } from "node:crypto";

export const MAX_CHUNK = 100;
export const MAX_GENERATION = 9223372036854775807n;
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;

export type JobScope =
  | { kind: "global" }
  | { kind: "household"; householdId: string }
  | { kind: "user"; userId: string }
  | { kind: "household-resource"; householdId: string; resourceType: string; resourceId: string };
export type DueKind = "business-date" | "period" | "event";
export interface DueItemRequest {
  jobName: string;
  definitionVersion: string;
  scope: JobScope;
  due: { kind: DueKind; key: string };
  dueAt: string;
  payload: unknown;
}
export interface OperationalPolicy {
  leaseMs: number;
  maxClaimLifetimeMs: number;
  retryFailureLimit: number;
  retryDelaysMs: readonly number[];
}
export interface Claim { readonly itemId: string; readonly generation: string; readonly token: string; readonly workerId: string }
export type ItemState = "queued" | "running" | "retry_wait" | "succeeded" | "dead" | "outcome_unknown";
export type AttemptOutcome = "running" | "yielded" | "succeeded" | "retryable_failed" | "permanent_failed" | "expired" | "unknown";
export type KnownFailure = { kind: "retryable" | "permanent"; code: string };
export type JobTransition =
  | { kind: "yield"; checkpoint: unknown; result: unknown; processedCount: number }
  | { kind: "complete"; result: unknown; processedCount: number };

export class DurableJobError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "DurableJobError"; }
}
export const fail = (code: string): never => { throw new DurableJobError(code); };
export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function freezeValue<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}
export function assertClosed(value: object, fields: readonly string[], code: string): void {
  if (Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor);
  }) ||
      Object.keys(value).sort().join("|") !== [...fields].sort().join("|")) fail(code);
}
export function canonicalJson(value: unknown, maxBytes: number): string {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 16) return fail("JSON_DEPTH_EXCEEDED");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isSafeInteger(item) && !Object.is(item, -0)) return item;
    if (Array.isArray(item)) {
      if (seen.has(item)) return fail("INVALID_JSON");
      seen.add(item);
      if (Reflect.ownKeys(item).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))) return fail("INVALID_JSON");
      const result: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(item, index)) return fail("INVALID_JSON");
        result.push(visit(item[index], depth + 1));
      }
      seen.delete(item);
      return result;
    }
    if (typeof item === "object" && item && Object.getPrototypeOf(item) === Object.prototype) {
      if (seen.has(item)) return fail("INVALID_JSON");
      seen.add(item);
      const result: Record<string, unknown> = Object.create(null);
      if (Reflect.ownKeys(item).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        return typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor);
      })) return fail("INVALID_JSON");
      for (const key of Object.keys(item).sort()) result[key] = visit((item as Record<string, unknown>)[key], depth + 1);
      seen.delete(item);
      return result;
    }
    return fail("INVALID_JSON");
  };
  const encoded = JSON.stringify(visit(value, 0));
  if (bytes(encoded) > maxBytes) fail("JSON_SIZE_EXCEEDED");
  return encoded;
}
export function validatePolicy(policy: OperationalPolicy): OperationalPolicy {
  if (!policy || typeof policy !== "object") return fail("INVALID_POLICY");
  assertClosed(policy, ["leaseMs", "maxClaimLifetimeMs", "retryFailureLimit", "retryDelaysMs"], "INVALID_POLICY");
  const { leaseMs, maxClaimLifetimeMs, retryFailureLimit, retryDelaysMs } = policy;
  if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 300_000 ||
      !Number.isInteger(maxClaimLifetimeMs) || maxClaimLifetimeMs < leaseMs || maxClaimLifetimeMs > 900_000 ||
      !Number.isInteger(retryFailureLimit) || retryFailureLimit < 1 || retryFailureLimit > 10 ||
      !Array.isArray(retryDelaysMs) || retryDelaysMs.length !== retryFailureLimit - 1 || retryDelaysMs.length > 9 ||
      retryDelaysMs.some(ms => !Number.isInteger(ms) || ms < 0 || ms > 3_600_000)) return fail("INVALID_POLICY");
  return Object.freeze({ leaseMs, maxClaimLifetimeMs, retryFailureLimit, retryDelaysMs: Object.freeze([...retryDelaysMs]) });
}
export function validateCode(code: string): string {
  if (typeof code !== "string" || !ERROR_CODE.test(code)) return fail("INVALID_ERROR_CODE");
  return code;
}
export function validateRequest(input: DueItemRequest, allowedResources: readonly string[] | null): DueItemRequest & { scopeKey: string; payloadText: string; payloadHash: string } {
  if (!input || typeof input !== "object") return fail("INVALID_REQUEST");
  assertClosed(input, ["jobName", "definitionVersion", "scope", "due", "dueAt", "payload"], "INVALID_REQUEST");
  if (typeof input.jobName !== "string" || bytes(input.jobName) > 96 || !KEY.test(input.jobName)) return fail("INVALID_JOB_NAME");
  if (typeof input.definitionVersion !== "string" || bytes(input.definitionVersion) > 96 || !KEY.test(input.definitionVersion)) return fail("INVALID_DEFINITION_VERSION");
  const scope = input.scope;
  if (!scope || typeof scope !== "object") return fail("INVALID_SCOPE");
  let fields: string[];
  switch (scope.kind) {
    case "global": fields = ["kind"]; break;
    case "household": fields = ["kind", "householdId"]; break;
    case "user": fields = ["kind", "userId"]; break;
    case "household-resource": fields = ["kind", "householdId", "resourceType", "resourceId"]; break;
    default: return fail("INVALID_SCOPE");
  }
  assertClosed(scope, fields, "INVALID_SCOPE");
  for (const key of ["householdId", "userId", "resourceId"] as const) {
    if (key in scope && (typeof scope[key as keyof JobScope] !== "string" || !UUID.test(scope[key as keyof JobScope] as string))) return fail("INVALID_SCOPE");
  }
  if (scope.kind === "household-resource" && (typeof scope.resourceType !== "string" || (allowedResources !== null && !allowedResources.includes(scope.resourceType)) || bytes(scope.resourceType) > 64 || !KEY.test(scope.resourceType))) return fail("INVALID_SCOPE");
  const scopeKey = JSON.stringify(scope.kind === "global" ? ["global"] : scope.kind === "household" ? ["household", scope.householdId] : scope.kind === "user" ? ["user", scope.userId] : ["household-resource", scope.householdId, scope.resourceType, scope.resourceId]);
  if (!input.due || typeof input.due !== "object") return fail("INVALID_DUE");
  assertClosed(input.due, ["kind", "key"], "INVALID_DUE");
  if (!["business-date", "period", "event"].includes(input.due.kind) || typeof input.due.key !== "string" || !KEY.test(input.due.key) || bytes(input.due.key) > 512 || bytes(scopeKey + input.due.key + input.jobName) > 1024) return fail("INVALID_DUE");
  if (typeof input.dueAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.dueAt) || !Number.isFinite(Date.parse(input.dueAt)) || new Date(input.dueAt).toISOString() !== input.dueAt) return fail("INVALID_DUE_AT");
  const payloadText = canonicalJson(input.payload, 65_536);
  return freezeValue({ jobName: input.jobName, definitionVersion: input.definitionVersion,
    scope: JSON.parse(JSON.stringify(scope)) as JobScope, due: { ...input.due }, dueAt: input.dueAt,
    payload: JSON.parse(payloadText), scopeKey, payloadText, payloadHash: sha256(payloadText) });
}
