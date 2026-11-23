/**
 * Real-DB fixture shared by the safe-missing-tests lane: one owner, one household,
 * one logged-in session. Rows are written directly; the code under test is only
 * ever reached through the HTTP app.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { db, pool } from "../db";
import { hashPassword } from "../auth";
import { getTestApp } from "./fixtures";

const PASSWORD = "SyntheticMissingTests123!";

export interface SignedHousehold {
  app: Awaited<ReturnType<typeof getTestApp>>;
  householdId: string;
  userId: string;
  currency: string;
  /** Cookie plus the subject/household headers the signed routes expect. */
  headers: { Cookie: string; "X-Capital-Subject": string; "X-Capital-Household": string };
  /**
   * Delete everything the fixture wrote. `cleanupFirst` removes rows the test added.
   * `householdCascade` leaves transactions, merchants and accounts to the household delete,
   * for evidence tables (receipt conversions) that only allow deletion through that cascade.
   */
  cleanup: (cleanupFirst?: () => Promise<void>, householdCascade?: boolean) => Promise<void>;
}

export async function createSignedHousehold(label: string, currency = "USD"): Promise<SignedHousehold> {
  const app = await getTestApp();
  const householdId = randomUUID();
  const userId = randomUUID();
  const email = `${label}-${userId}@example.invalid`;

  await db.insert(households).values({ id: householdId, name: `Synthetic ${label}`, currency });
  await db.insert(users).values({
    id: userId, email, username: `${label}-${userId}`,
    passwordHash: await hashPassword(PASSWORD), emailVerified: true,
  });
  await db.insert(householdMembers).values({ householdId, userId, role: "owner" });

  const login = await request(app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");

  return {
    app, householdId, userId, currency,
    headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId },
    cleanup: async (cleanupFirst, householdCascade = false) => {
      if (cleanupFirst) await cleanupFirst();
      await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      if (!householdCascade) {
        await db.delete(transactions).where(eq(transactions.householdId, householdId));
        await db.delete(merchants).where(eq(merchants.householdId, householdId));
        await db.delete(accounts).where(eq(accounts.householdId, householdId));
      }
      await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [userId]);
      await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
      await db.delete(users).where(eq(users.id, userId));
    },
  };
}

/** Insert a plain checking account owned by the fixture user. */
export async function insertAccount(
  fixture: Pick<SignedHousehold, "householdId" | "userId" | "currency">,
  overrides: Partial<typeof accounts.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({
    id, householdId: fixture.householdId, ownerUserId: fixture.userId, name: "Synthetic account",
    type: "checking", currency: fixture.currency, isAsset: true,
    initialBalance: "100.00", balance: "100.00", isPrivate: false, ...overrides,
  });
  return id;
}
