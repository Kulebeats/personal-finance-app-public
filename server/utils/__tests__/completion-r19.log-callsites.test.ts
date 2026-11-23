import { afterEach, expect, it, vi } from "vitest";
import request from "supertest";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Transaction } from "@shared/schema";
import type { RuleActionPlan } from "../../services/rule/types";

const fixture = vi.hoisted(() => ({
  ruleId: "11111111-2222-4333-8444-555555555555", transactionId: "22222222-3333-4444-8555-666666666666",
  userId: "33333333-4444-4555-8666-777777777777", householdId: "44444444-5555-4666-8777-888888888888",
  callbacks: [] as Array<() => void>,
}));
vi.mock("../../repositories/RuleRepository", () => ({ ruleRepository: { findEnabledByHousehold: vi.fn().mockResolvedValue([
  { id: fixture.ruleId, name: "PRIVATE_RULE_SENTINEL" },
]) } }));
vi.mock("../../repositories/TransactionRepository", () => ({ transactionRepository: { update: vi.fn().mockResolvedValue({}) } }));
vi.mock("../../services/rule/matching", () => ({ matchesRule: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/rule/actions", () => ({ evaluateActions: vi.fn().mockResolvedValue({ updates: { notes: "PRIVATE_FINANCE_SENTINEL", amount: "777.77" }, linkGoalIds: [], effects: [], blocked: { categoryIds: [], tagIds: [] } } satisfies RuleActionPlan), linkGoalsToTransaction: vi.fn() }));
vi.mock("../withTransaction", () => ({ withTransaction: async (work: (tx: object) => Promise<unknown>) => work({}) }));
vi.mock("../../config/session-store", async () => { const { default: session } = await import("express-session"); return { sessionStore: new session.MemoryStore() }; });
vi.mock("../../db", () => ({ pool: { query: vi.fn().mockRejectedValue(new Error("synthetic outage")) }, db: { select: () => ({ from: async () => [{ id: fixture.userId }] }) } }));
vi.mock("../../config/redis", () => ({ redis: null, productionRedis: null, assertRequiredJobCapabilities: vi.fn(), withRedisLock: async (_key: string, _ttl: number, work: () => Promise<void>) => { await work(); return { ran: true }; } }));
vi.mock("../../routes", () => ({ registerRoutes: vi.fn() }));
vi.mock("../../startup", () => ({ initializeServices: vi.fn() }));
vi.mock("../../auth", () => ({ attachUser: (_req: Request, _res: Response, next: NextFunction) => next(), requireAuth: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../middleware/householdGuard", () => ({ householdGuard: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../middleware/uploadsAuth", () => ({ serveUpload: vi.fn() }));
vi.mock("node-cron", () => ({ default: { schedule: (_schedule: string, work: () => void) => fixture.callbacks.push(work) } }));
vi.mock("../../modules/auth/auth.security.report", () => ({ authSecurityReportService: { sendDailySecurityReport: vi.fn().mockRejectedValue(new Error("PRIVATE_SECURITY_SENTINEL")) } }));
vi.mock("../../repositories/NotificationRepository", () => ({ notificationRepository: { autoArchiveOldRead: vi.fn().mockResolvedValue(3), purgeArchived: vi.fn().mockResolvedValue(2) } }));
vi.mock("../../modules/weekly-recap/weekly-recap.email.service", () => ({ processWeeklyRecapEmails: vi.fn() }));
import { ruleService } from "../../services/rule/service";
import { app } from "../../app";
import { runDailySecurityReport, runNotificationCleanup } from "../../core/scheduling/jobRunners";
import { logger } from "../logger";

const router = Router();
router.get("/log-fixture/:resource", (req, res) => {
  logger.request(req, "Synthetic request action", { route: req.path });
  logger.requestError(req, "Synthetic request failure", new Error("PRIVATE_ERROR_SENTINEL"));
  res.json({ ok: true });
});
app.use("/api/rules", router);
const dynamicRouter = Router();
dynamicRouter.get("/detail/:item", (_req, res) => res.json({ ok: true }));
app.use("/api/log-private/:owner", dynamicRouter);
afterEach(() => { vi.restoreAllMocks(); fixture.callbacks.length = 0; });

it("actual rule application emits a static label, masked typed identities and counts without names or financial payload", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const result = await ruleService.applyRules({ id: fixture.transactionId } as Transaction, fixture.householdId);
  expect(result).toMatchObject({ notes: "PRIVATE_FINANCE_SENTINEL", amount: "777.77" });
  const entry = JSON.parse(output.mock.calls[0][0] as string);
  expect(entry).toMatchObject({ message: "Rule updates prepared", ruleId: "11111111...", transactionId: "22222222...", updatesCount: 2 });
  expect(JSON.stringify(entry)).not.toMatch(/PRIVATE_|777\.77/);
  expect(JSON.stringify(entry)).not.toContain(fixture.transactionId);
});

it("actual app HTTP logs preserve controlled mounted templates and omit arbitrary path/query/parameter values", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await request(app).get("/api/rules/log-fixture/PRIVATE_PARAMETER_SENTINEL?query=PRIVATE_QUERY_SENTINEL").expect(200);
  await request(app).get("/api/log-private/PRIVATE_OWNER_SENTINEL/detail/PRIVATE_ITEM_SENTINEL").expect(200);
  await request(app).get("/api/PRIVATE_UNKNOWN_PATH_SENTINEL?secret=PRIVATE_UNKNOWN_QUERY_SENTINEL").expect(404);
  const entries = [...output.mock.calls, ...warnings.mock.calls, ...errors.mock.calls].map(([value]) => JSON.parse(value as string));
  expect(JSON.stringify(entries)).not.toMatch(/PRIVATE_/);
  expect(entries).toContainEqual(expect.objectContaining({ message: "HTTP request completed", route: "/api/rules/log-fixture/:resource", statusCode: 200 }));
  expect(entries).toContainEqual(expect.objectContaining({ message: "HTTP request completed", route: "unmatched", statusCode: 404 }));
  expect(entries).toContainEqual(expect.objectContaining({ message: "HTTP request completed", route: "mounted/detail/:item", statusCode: 200 }));
  expect(entries).toContainEqual(expect.objectContaining({ message: "Synthetic request action", route: "/api/rules/log-fixture/:resource" }));
  expect(entries).toContainEqual(expect.objectContaining({ message: "Synthetic request failure", route: "/api/rules/log-fixture/:resource", error: expect.objectContaining({ name: "Error" }) }));
  // R19 + OPS-014: the error keeps its name and frames, never its message.
  const failure = entries.find((entry) => entry.message === "Synthetic request failure");
  expect(failure.error).not.toHaveProperty("message");
});

it("actual scheduled-job failure and cleanup logs retain reviewed counts and omit user/error sentinels", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  // The scheduler now runs these under a Postgres lock and journal (covered in
  // scheduler.realdb); this test owns only what their logs admit.
  expect(await runDailySecurityReport()).toEqual({ processed: 0, failed: 1 });
  expect(await runNotificationCleanup()).toEqual({ archived: 3, purged: 2 });
  expect(errors).toHaveBeenCalled();
  const entries = [...output.mock.calls, ...errors.mock.calls].map(([value]) => JSON.parse(value as string));
  expect(JSON.stringify(entries)).not.toMatch(/PRIVATE_/);
  expect(JSON.stringify(entries)).not.toContain(fixture.userId);
  expect(entries).toContainEqual(expect.objectContaining({ message: "Security report generation failed", userId: "33333333...", job: "daily-security-report" }));
  expect(entries).toContainEqual(expect.objectContaining({ message: "Notification cleanup completed", archived: 3, purged: 2 }));
});

it("actual serialized logger keeps only reviewed numeric outcome aliases", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const metrics = { matched: 2, households: 3, totalAlerts: 4, notificationsSent: 5, totalGoals: 6, updatedCount: 7, statusChanges: 8, remindersSent: 9, reminderDays: 10 };
  logger.info("Reviewed job outcomes", { job: "synthetic-job", metrics, ...metrics, assets: 777.77, matchedRows: [{ name: "PRIVATE_FINANCE_SENTINEL" }] });
  const entry = JSON.parse(output.mock.calls[0][0] as string);
  expect(entry).toMatchObject({ metrics, ...metrics, assets: "[REDACTED]", matchedRows: "[REDACTED]" });
  expect(JSON.stringify(entry)).not.toMatch(/PRIVATE_|777\.77/);
});

it.each(["PRIVATE_COUNTER_SENTINEL", -1, 1.5, Infinity, { value: "PRIVATE_COUNTER_SENTINEL" }])("reviewed counter names still reject non-count payload %j", (value) => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  logger.info("Counter validation", { matched: value, totalAlerts: value, remindersSent: value, metrics: { households: value } });
  const entry = JSON.parse(output.mock.calls[0][0] as string);
  expect(entry).toMatchObject({ matched: "[REDACTED]", totalAlerts: "[REDACTED]", remindersSent: "[REDACTED]", metrics: { households: "[REDACTED]" } });
  expect(JSON.stringify(entry)).not.toContain("PRIVATE_COUNTER_SENTINEL");
});
