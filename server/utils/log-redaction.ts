const REDACTED = "[REDACTED]";
const identityKeys = new Set(["userid", "householdid", "actorid", "requesterid", "ruleid", "transactionid", "eventid"]);
// Only reviewed operational metadata is admitted. New domain fields fail closed
// until explicitly classified; a credential/financial alias cannot bypass this.
const labelKeys = new Set(["requestid", "runid", "job", "jobname", "provider", "model", "outcome",
  "action", "route", "method", "errorclass", "status", "dependency", "phase", "eventtype"]);
const countKeys = new Set(["attempt", "attempts", "count", "processed", "failed", "created", "sent", "skipped",
  "pending", "deleted", "suppressed", "totalprocessed", "totalfailed", "retrycount", "errorcount",
  "inputtokens", "outputtokens", "totaltokens", "statuscode", "matched", "households", "totalalerts", "notificationssent",
  "totalgoals", "updatedcount", "statuschanges", "reminderssent", "reminderdays", "archived", "purged", "updatescount", "linkgoalidscount"]);
const durationKeys = new Set(["duration", "durationms", "latencyms", "lagms"]);
const safeErrorNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AbortError", "TimeoutError", "ValidationError", "DatabaseError", "AggregateError"]);
const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

// Driver codes (ECONNRESET, SQLSTATE) and app codes (MISSING_FX_RATE).
const SAFE_ERROR_CODE = /^(?:E[A-Z0-9_]{1,47}|[0-9][0-9A-Z]{4}|XX[0-9]{3}|[A-Z][A-Z0-9_]{1,63})$/;
// R19: no error text reaches logs. The scrubber below is a deny-list, so plain
// interpolated words could still carry personal data. Owner question (PR #198):
// should logs keep a scrubbed message of at most 200 characters? A yes is this flip.
const LOG_ERROR_MESSAGES: boolean = false;
const MESSAGE_LIMIT = 200;
const STACK_FRAME_LIMIT = 5;
const STACK_FRAME_LENGTH = 200;
// V8 gives every error one shared native stack accessor. Only that accessor is
// ever called, so an error-defined getter cannot run while being logged.
const NATIVE_STACK_GETTER = Object.getOwnPropertyDescriptor(new Error(), "stack")?.get;
type Scrub = readonly [RegExp, string];
// Ordered: SQL goes first, so later rules never see its text.
const SQL_SCRUB: Scrub = [/Failed query:[\s\S]*/i, "Failed query: [sql]"];
const VALUE_SCRUBS: readonly Scrub[] = [
  [/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]"],
  [/[^\s@"'`<>()]+@[^\s@"'`<>()]+/g, "[email]"],
  [/\b(?:Bearer|Basic)\s+\S+/gi, "[credential]"],
  [/(["'`])[^"'`]*\1/g, "[value]"],
  // An unpaired quote (a truncated snippet) drops everything after it.
  [/["'`][\s\S]*$/, "[value]"],
];
const MESSAGE_SCRUBS: readonly Scrub[] = [
  SQL_SCRUB,
  ...VALUE_SCRUBS,
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/[A-Za-z0-9+/_=-]{24,}/g, "[token]"],
  [/[-+]?\d[\d.,:]*/g, "[n]"],
];
const scrub = (text: string, rules: readonly Scrub[]) =>
  rules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);

function safeMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const scrubbed = scrub(value.slice(0, 4 * MESSAGE_LIMIT), MESSAGE_SCRUBS).replace(/\s+/g, " ").trim();
  return scrubbed.slice(0, MESSAGE_LIMIT) || undefined;
}

const NOT_DATA = Symbol("accessor");

/** The value `key` resolves to along the prototype chain, or NOT_DATA when an accessor answers. */
function dataValue(target: object, key: string): unknown {
  for (let current: object | null = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : NOT_DATA;
  }
  return undefined;
}

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";
const lineBreaks = (text: string | undefined) => (text ? text.split("\n").length - 1 : 0);

function safeStack(descriptor: PropertyDescriptor | undefined, error: Error): string[] | undefined {
  if (!descriptor || !NATIVE_STACK_GETTER || descriptor.get !== NATIVE_STACK_GETTER) return undefined;
  // V8 formats the stack on first read from `name` and `message`. Only plain
  // strings there, so no accessor or toString can run while logging.
  const name = dataValue(error, "name");
  const message = dataValue(error, "message");
  if (!isOptionalString(name) || !isOptionalString(message)) return undefined;
  const stack: unknown = NATIVE_STACK_GETTER.call(error);
  if (typeof stack !== "string") return undefined;
  // The header is `name: message`, and both may span lines. Skip exactly those
  // lines, so no line of the message can pass as a frame. A header that no
  // longer holds the current name and message is stale and keeps no frames.
  const lines = stack.split("\n");
  const headerLength = 1 + lineBreaks(name) + lineBreaks(message);
  const header = lines.slice(0, headerLength).join("\n");
  if ((name && !header.includes(name)) || (message && !header.includes(message))) return undefined;
  const frames = lines.slice(headerLength).map((line) => line.trim()).filter((line) => line.startsWith("at "))
    .slice(0, STACK_FRAME_LIMIT).map((frame) => scrub(frame, VALUE_SCRUBS).slice(0, STACK_FRAME_LENGTH));
  return frames.length > 0 ? frames : undefined;
}

/**
 * Error identity for logs (OPS-014, R19). Any thrown value keeps its safe name
 * and a driver or app code. A genuine Error also keeps at most five scrubbed
 * stack frames, never a line of its message. The message itself is not logged
 * unless LOG_ERROR_MESSAGES is on. A plain object or string keeps nothing more:
 * its fields were never an error's.
 */
function safeError(value: unknown): unknown {
  if (!value || typeof value !== "object") return REDACTED;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const candidate = descriptors.name?.value ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value) ?? {}, "name")?.value;
  const name = safeErrorNames.has(candidate) ? candidate : "Error";
  const code = descriptors.code?.value;
  const identity = { name, ...(typeof code === "string" && SAFE_ERROR_CODE.test(code) ? { code } : {}) };
  if (!(value instanceof Error)) return identity;
  const message = LOG_ERROR_MESSAGES ? safeMessage(descriptors.message?.value) : undefined;
  const stack = safeStack(descriptors.stack, value);
  return { ...identity, ...(message ? { message } : {}), ...(stack ? { stack } : {}) };
}

export function hashId(id: string | undefined): string | undefined {
  return id ? `${id.substring(0, 8)}...` : undefined;
}

/** Bounded allowlist, with no arbitrary nested object/array or getter traversal. */
export function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const clean = (key: string, value: unknown): unknown => {
    const field = normalize(key);
    if (field === "error") return safeError(value);
    if (identityKeys.has(field)) return typeof value === "string" ? hashId(value) : REDACTED;
    if (labelKeys.has(field)) {
      return typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,128}$/.test(value) ? value : REDACTED;
    }
    if (countKeys.has(field)) return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : REDACTED;
    if (durationKeys.has(field)) return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : REDACTED;
    if (field === "metrics" && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 50).map(([name, descriptor]) => [name,
        "value" in descriptor && (countKeys.has(normalize(name)) || durationKeys.has(normalize(name)))
          ? clean(name, descriptor.value) : REDACTED]));
    }
    return REDACTED;
  };
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(obj)).slice(0, 100)
    .map(([key, descriptor]) => [key, "value" in descriptor ? clean(key, descriptor.value) : REDACTED]));
}
