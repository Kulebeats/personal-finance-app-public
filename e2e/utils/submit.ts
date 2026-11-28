import { randomUUID } from "node:crypto";
import type { Page, Response, Route } from "@playwright/test";
import { hasRewrite, isCorruptStep, recordRewrite, recordRewriteStatus } from "./read-back";
import { valueText } from "./money-value";

export { readBack, setCorruptStep } from "./read-back";

/**
 * One submit in a spec: the click that sends a write, and the response the
 * spec then reads back.
 *
 * QA-01 / R20.2 mutation check (`PFA_E2E_MUTATION=each-step`, see
 * e2e/utils/mutants.ts, read-back.ts and scripts/e2e-mutation-check.mjs). A
 * corrupt mutant makes the click, but the outgoing request body has
 * `corruptField` changed, so the write succeeds with a wrong value and only
 * the spec's read-back can notice. The spec never sees that a mutation is
 * active, so it cannot pass the check by detecting it.
 *
 * The rewritten request carries a unique `x-e2e-mutant` header, and the
 * submit returns that request's own response: another request to the same
 * path (a second budget's PUT, say) can neither supply the 2xx evidence nor
 * the response the spec goes on to use.
 */
export interface SubmitStep {
  name: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string | RegExp;
  /**
   * Request-body field a corrupt mutant changes (money, number, text or
   * boolean). A dotted path reaches a nested field ("optionalWidgets.monthlyTrends.enabled",
   * "rows.0.amount": a numeric segment indexes an array).
   */
  corruptField?: string;
}

export const MUTANT_HEADER = "x-e2e-mutant";
const NUMERIC = /^(-?)(\d+)(\.\d+)?$/;

function pathMatches(pattern: string | RegExp, pathname: string): boolean {
  return typeof pattern === "string" ? pathname === pattern : pattern.test(pathname);
}

/** "42.50" -> "43.50": integer-part increment on the string, no float arithmetic. */
function bumpNumeric(value: string): string | undefined {
  const match = NUMERIC.exec(value);
  if (!match) return undefined;
  return `${match[1]}${(BigInt(match[2]) + 1n).toString()}${match[3] ?? ""}`;
}

function corruptValue(value: unknown): unknown {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") return bumpNumeric(value) ?? `${value} mutant`;
  if (value && typeof value === "object" && "amount" in value && typeof value.amount === "string") {
    const amount = bumpNumeric(value.amount);
    return amount === undefined ? undefined : { ...value, amount };
  }
  return undefined;
}

interface CorruptedBody { body: Record<string, unknown>; original: string; corrupted: string }

type Container = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Container => !!value && typeof value === "object";

/** The value at `path` (own keys or array indexes only), or `undefined` when the path does not exist. */
function valueAt(value: unknown, path: readonly string[]): { found: boolean; value: unknown } {
  if (path.length === 0) return { found: true, value };
  if (!isContainer(value) || !Object.prototype.hasOwnProperty.call(value, path[0])) return { found: false, value: undefined };
  return valueAt((value as Record<string, unknown>)[path[0]], path.slice(1));
}

/** A copy of `container` with the value at `path` replaced; the original is never mutated. */
function withValueAt(container: Container, path: readonly string[], next: unknown): Container {
  const [key, ...rest] = path;
  const current = (container as Record<string, unknown>)[key];
  const replaced = rest.length === 0 ? next : withValueAt(current as Container, rest, next);
  if (Array.isArray(container)) return container.map((item, index) => (String(index) === key ? replaced : item));
  return { ...container, [key]: replaced };
}

/** The request body with `field` (a key or dotted path) changed, or `undefined` when it has no such field. */
function corruptBody(body: unknown, field: string): CorruptedBody | undefined {
  if (!isContainer(body) || Array.isArray(body)) return undefined;
  const path = field.split(".");
  const target = valueAt(body, path);
  if (!target.found) return undefined;
  const changed = corruptValue(target.value);
  const original = valueText(target.value);
  const corrupted = valueText(changed);
  if (changed === undefined || original === undefined || corrupted === undefined) return undefined;
  return { body: withValueAt(body, path, changed) as Record<string, unknown>, original, corrupted };
}

/**
 * Routes this step's first matching request through a body rewrite tagged
 * `mutantId`; returns the unroute.
 *
 * The route lives on the browser context, not the page. The page has no other
 * routes, so unrouting there empties its interception patterns. Playwright's
 * server then re-dispatches every request in flight through the page to the
 * context (`Route.removeHandler`), while the client is already passing the
 * same Route to the context. The protector then fulfils it twice ("Route is
 * already handled!"). The context always keeps the protector's `**` route, so
 * adding or removing this one never strands a request. Newer routes run first,
 * so this handler still falls back to the protector.
 */
async function corruptNextRequest(page: Page, step: SubmitStep, mutantId: string): Promise<() => Promise<void>> {
  const field = step.corruptField;
  const matcher = (url: URL) => pathMatches(step.path, url.pathname);
  const handler = async (route: Route) => {
    const request = route.request();
    if (!field || hasRewrite() || request.method() !== step.method) return route.fallback();
    let body: unknown;
    try { body = request.postDataJSON(); } catch { return route.fallback(); }
    const changed = corruptBody(body, field);
    if (!changed) return route.fallback();
    recordRewrite(step, changed.original, changed.corrupted);
    return route.fallback({
      postData: JSON.stringify(changed.body),
      headers: { ...request.headers(), [MUTANT_HEADER]: mutantId },
    });
  };
  const context = page.context();
  await context.route(matcher, handler);
  return () => context.unroute(matcher, handler);
}

export async function submitStep(page: Page, step: SubmitStep, click: () => Promise<void>): Promise<Response> {
  const isMatch = (response: Response) =>
    response.request().method() === step.method && pathMatches(step.path, new URL(response.url()).pathname);
  if (!isCorruptStep(step)) {
    const pending = page.waitForResponse(isMatch);
    await click();
    return await pending;
  }
  const mutantId = `${step.name}-${randomUUID()}`;
  const unroute = await corruptNextRequest(page, step, mutantId);
  try {
    const tagged = page.waitForResponse((response) => response.request().headers()[MUTANT_HEADER] === mutantId);
    // Never awaited when nothing was rewritten; the evidence check reports that.
    tagged.catch(() => undefined);
    const first = page.waitForResponse(isMatch);
    await click();
    const firstResponse = await first;
    if (!hasRewrite()) return firstResponse;
    const response = await tagged;
    recordRewriteStatus(response.status());
    return response;
  } finally {
    await unroute();
  }
}

/** Submits, expects `expectedStatus`, and returns the parsed V7 envelope's `data`. */
export async function submitForData<T>(page: Page, step: SubmitStep, click: () => Promise<void>, expectedStatus = 201): Promise<T> {
  const response = await submitStep(page, step, click);
  if (response.status() !== expectedStatus) {
    throw new Error(`${step.name}: ${step.method} ${response.url()} returned ${response.status()}, expected ${expectedStatus}`);
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("success" in body) || body.success !== true || !("data" in body)) {
    throw new Error(`${step.name}: response is not a success envelope`);
  }
  return body.data as T;
}
