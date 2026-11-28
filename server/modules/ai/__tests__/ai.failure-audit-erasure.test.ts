import { householdMembers, households, users } from "@shared/schema";
import { beforeEach, expect, it, vi } from "vitest";
import { ConsentRevokedError } from "../ai.consent-policy";
import { AIService } from "../ai.service";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), logAudit: vi.fn(), run: vi.fn(), logError: vi.fn(), queryFailed: vi.fn(),
}));
vi.mock("../../../db", () => ({ db: {
  query: { households: { findFirst: async () => ({ currency: "ZMW" }) } }, transaction: mocks.transaction,
} }));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: { log: mocks.logAudit } }));
vi.mock("../../../utils/logger", () => ({ logger: { error: mocks.logError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock("../ai.analytics.service", () => ({ AIAnalyticsService: class {} }));
vi.mock("../ai.conversation.service", () => ({ AIConversationService: class {} }));
vi.mock("../ai.cache", () => ({ aiCache: {} }));
vi.mock("../ai.provider-caps", () => ({ capGatedAdapters: () => [] }));
vi.mock("../ai.provider-orchestrator", async importOriginal => ({
  ...await importOriginal<typeof import("../ai.provider-orchestrator")>(),
  ProviderOrchestrator: class {
    hasConfiguredProvider() { return false; }
    run = mocks.run;
  },
}));
vi.mock("../ai.tracking", () => ({ aiTracking: { trackQuerySent: vi.fn(), trackQueryFailed: mocks.queryFailed } }));

const actor = { householdId: "household", userId: "member", role: "member" } as const;
const question = "How much was SYNTHETIC_QUERY spending?";
const failure = new Error("Synthetic diagnostic contains SYNTHETIC_ERROR");

let householdPresent: boolean;
let memberPresent: boolean;
let erasedAt: Date | null;
const locks: string[] = [];
const tx = { select: () => ({ from: (table: unknown) => ({ where: () => ({ for: async (mode: string) => {
  if (table === households) { locks.push(`household ${mode}`); return householdPresent ? [{ given: true, version: "v2.0" }] : []; }
  if (table === householdMembers) { locks.push(`membership ${mode}`); return memberPresent ? [{ role: "member" }] : []; }
  if (table === users) { locks.push(`user ${mode}`); return [{ erasedAt }]; }
  throw new Error("Unexpected audit query");
} }) }) }) };

beforeEach(() => {
  vi.resetAllMocks();
  memberPresent = householdPresent = true;
  erasedAt = null;
  locks.length = 0;
  mocks.transaction.mockImplementation(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
});

function processQuery() {
  return new AIService().processQuery({ householdId: actor.householdId, userId: actor.userId, actor, message: question });
}

it("writes a content-free failure if a request fails after its actor was erased", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<never>();
  mocks.run.mockImplementation(() => { entered.resolve(); return release.promise; });
  const rejected = expect(processQuery()).rejects.toMatchObject({ statusCode: 500 });
  await entered.promise;
  memberPresent = false;
  erasedAt = new Date("2026-11-21T20:00:00Z");
  release.reject(failure);
  await rejected;

  expect(locks).toEqual(["household key share", "membership share", "user share"]);
  expect(mocks.logAudit).toHaveBeenCalledOnce();
  const [audit] = mocks.logAudit.mock.calls[0];
  expect(audit).toMatchObject({ tx, userId: actor.userId, entityType: "ai_query",
    details: { success: false, actor_removed: true, content_erased: true } });
  expect(audit.details).not.toHaveProperty("query");
  expect(audit.details).not.toHaveProperty("error");
  for (const logged of [mocks.logError.mock.calls, mocks.queryFailed.mock.calls]) {
    expect(JSON.stringify(logged)).not.toMatch(/SYNTHETIC_QUERY|SYNTHETIC_ERROR/);
  }
});

it("keeps the normal failure audit inside the locks for an active member", async () => {
  mocks.run.mockRejectedValue(failure);
  await expect(processQuery()).rejects.toMatchObject({ statusCode: 500 });
  expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ tx,
    details: expect.objectContaining({ query: question, error: "UNKNOWN_ERROR", error_class: "Error", success: false }) }));
});

it("records a failure's code and class, never its raw message, in the audit row", async () => {
  mocks.run.mockRejectedValue(failure);
  await expect(processQuery()).rejects.toMatchObject({ statusCode: 500 });
  const [audit] = mocks.logAudit.mock.calls[0];
  expect(JSON.stringify(audit.details)).not.toContain("SYNTHETIC_ERROR");
});

it("retains the original consent refusal and audits the outcome without content", async () => {
  const refusal = new ConsentRevokedError();
  mocks.run.mockRejectedValue(refusal);
  await expect(processQuery()).rejects.toBe(refusal);
  expect(mocks.logAudit).toHaveBeenCalledOnce();
  const [audit] = mocks.logAudit.mock.calls[0];
  expect(audit).toMatchObject({ tx, details: { consent_revoked: true, success: false } });
  expect(audit.details).not.toHaveProperty("query");
  expect(audit.details).not.toHaveProperty("error");
});

it("preserves the query response when a failure audit cannot be recorded", async () => {
  const refusal = new ConsentRevokedError();
  mocks.run.mockRejectedValue(refusal);
  mocks.logAudit.mockRejectedValue(new Error("Synthetic audit store outage"));
  await expect(processQuery()).rejects.toBe(refusal);
});

it("does not write an audit with a deleted household foreign key", async () => {
  householdPresent = false;
  mocks.run.mockRejectedValue(failure);
  await expect(processQuery()).rejects.toMatchObject({ statusCode: 500 });
  expect(locks).toEqual(["household key share"]);
  expect(mocks.logAudit).not.toHaveBeenCalled();
});
