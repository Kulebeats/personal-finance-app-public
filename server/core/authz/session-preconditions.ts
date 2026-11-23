import type { Request } from "express";
import { HttpError } from "../errors";
import type { Household } from "@shared/schema";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { resolveImplicitHouseholdSelection, type HouseholdContext, type ImplicitHouseholdSelection } from "./implicit-household-context";

interface SessionPreconditions { subject?: string; household?: string }
class InvalidSessionPreconditionError extends HttpError {
  readonly statusCode = 400;
  readonly code = "BAD_REQUEST";
  constructor() { super("Invalid session context expectation"); }
}
export class SessionContextChangedError extends HttpError {
  readonly statusCode = 409;
  readonly code = "SESSION_CONTEXT_CHANGED";
  constructor() { super("Session context changed. Refresh your session and try again."); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function expectation(req: Request, name: string): string | undefined {
  const value = req.headers?.[name];
  const occurrences = (req.rawHeaders ?? []).filter((_value, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length;
  if (occurrences > 1 || (value !== undefined && (typeof value !== "string" || !uuid.test(value)))) {
    throw new InvalidSessionPreconditionError();
  }
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

/** Optional first-party preconditions grant no authority and reveal no identity. */
export function readSessionPreconditions(req: Request): SessionPreconditions {
  return { subject: expectation(req, "x-capital-subject"), household: expectation(req, "x-capital-household") };
}
export function assertSubjectPrecondition(preconditions: SessionPreconditions, userId: string): void {
  if (preconditions.subject && preconditions.subject !== userId.toLowerCase()) throw new SessionContextChangedError();
}
export function assertHouseholdPrecondition(preconditions: SessionPreconditions, householdId?: string): void {
  if (preconditions.household && preconditions.household !== householdId?.toLowerCase()) throw new SessionContextChangedError();
}

// Cache only context resolved during this request after authoritative auth. A
// second guard must not select a different household; attachUser is never read.
const resolvedContexts = new WeakMap<Request, { userId: string; selection?: ImplicitHouseholdSelection }>();
export async function resolveRequestImplicitHouseholdContext(req: Request, userId: string): Promise<HouseholdContext | undefined> {
  const resolved = resolvedContexts.get(req);
  if (resolved) {
    if (resolved.userId !== userId) throw new SessionContextChangedError();
    return resolved.selection?.context;
  }
  const selection = await resolveImplicitHouseholdSelection(userId);
  resolvedContexts.set(req, { userId, selection });
  return selection?.context;
}

/** Reuse the row (or authoritative absence) selected by this request's guard.
 * Legacy headerless controller callers keep their existing repository lookup.
 * A claimed context without its authoritative check must never fall back.
 */
export async function resolveRequestHousehold(req: Request, userId: string): Promise<Household | undefined> {
  const resolved = resolvedContexts.get(req);
  if (resolved) {
    if (resolved.userId !== userId) throw new SessionContextChangedError();
    return resolved.selection?.household;
  }
  const preconditions = readSessionPreconditions(req);
  assertSubjectPrecondition(preconditions, userId);
  if (preconditions.household) throw new SessionContextChangedError();
  return householdRepository.findByUserId(userId);
}
