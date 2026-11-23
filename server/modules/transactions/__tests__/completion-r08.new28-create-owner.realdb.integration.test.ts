/**
 * NEW-28: the owner chosen on create is the owner stored — REAL DB, REAL HTTP.
 *
 * The register cites `create.ts:186` always using the creator. Since
 * 09d19d600 the service keeps a supplied owner and the create boundary checks
 * that owner is a member of the household under FOR SHARE. This file pins both
 * through the public endpoint: a member owner and an explicit shared owner
 * persist, and an owner from another household is refused with no row written.
 */
import request from "supertest";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { accounts, auditLogs, householdMembers, households, transactions, users } from "@shared/schema";
import { db } from "../../../db";
import { hashPassword } from "../../../auth";
import { createTestUser, getTestApp } from "../../../__tests__/fixtures";

const PASSWORD = "OwnerChoice123";

describe("NEW-28 create keeps the chosen owner — real DB", () => {
  let app: Express;
  let cookie = "";
  const householdId = randomUUID();
  const otherHouseholdId = randomUUID();
  const accountId = randomUUID();
  const stamp = randomUUID().slice(0, 8);
  const creator = createTestUser({ email: `n28-creator-${stamp}@example.com`, username: `n28c-${stamp}` });
  const partner = createTestUser({ email: `n28-partner-${stamp}@example.com`, username: `n28p-${stamp}` });
  const outsider = createTestUser({ email: `n28-outsider-${stamp}@example.com`, username: `n28o-${stamp}` });
  const userIds = [creator.id, partner.id, outsider.id];

  const signed = () => ({ Cookie: cookie, "X-Capital-Subject": creator.id, "X-Capital-Household": householdId });
  const create = (name: string, ownerUserId: string | null) => request(app).post("/api/transactions").set(signed()).send({
    accountId, amount: { amount: "42.00", currency: "ZMW" }, type: "expense", date: "2026-10-05", name, ownerUserId,
  });
  const ownerOf = (id: string) => db.select({ ownerUserId: transactions.ownerUserId }).from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)));
  const createdId = (body: { data?: { id?: string; transaction?: { id?: string } } }) => body.data?.transaction?.id ?? body.data?.id ?? "";

  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([
      { id: householdId, name: "Owner choice HH", currency: "ZMW" },
      { id: otherHouseholdId, name: "Elsewhere HH", currency: "ZMW" },
    ]);
    const passwordHash = await hashPassword(PASSWORD);
    await db.insert(users).values([creator, partner, outsider].map((u) => ({
      id: u.id, email: u.email, username: u.username, fullName: u.fullName, emailVerified: true,
      passwordHash: u.id === creator.id ? passwordHash : u.passwordHash,
    })));
    await db.insert(householdMembers).values([
      { householdId, userId: creator.id, role: "owner" },
      { householdId, userId: partner.id, role: "member" },
      { householdId: otherHouseholdId, userId: outsider.id, role: "owner" },
    ]);
    await db.insert(accounts).values({
      id: accountId, householdId, name: "Shared current", type: "checking", currency: "ZMW",
      initialBalance: "500.00", balance: "500.00", isAsset: true, isPrivate: false, ownerUserId: null,
    });
    const login = await request(app).post("/api/auth/login").send({ email: creator.email, password: PASSWORD }).expect(200);
    cookie = ([] as string[]).concat(login.headers["set-cookie"] ?? []).join("; ");
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, [householdId, otherHouseholdId]));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(inArray(householdMembers.householdId, [householdId, otherHouseholdId]));
    await db.delete(households).where(inArray(households.id, [householdId, otherHouseholdId]));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  it("stores another member as the owner when the creator picks them", async () => {
    const response = await create("Partner's lunch", partner.id);
    expect(response.status).toBe(201);
    expect(await ownerOf(createdId(response.body))).toEqual([{ ownerUserId: partner.id }]);
  });

  it("stores no owner when the creator picks shared", async () => {
    const response = await create("Shared groceries", null);
    expect(response.status).toBe(201);
    expect(await ownerOf(createdId(response.body))).toEqual([{ ownerUserId: null }]);
  });

  it("refuses an owner from another household and writes nothing", async () => {
    const response = await create("Outsider owned", outsider.id);
    expect(response.status).toBe(404);
    const rows = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, householdId));
    expect(rows).toHaveLength(2);
  });
});
