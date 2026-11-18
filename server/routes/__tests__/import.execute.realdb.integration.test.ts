/**
 * Import execute REAL-DB integration tests (W1)
 *
 * Exercises POST /api/import/execute over real HTTP and real Postgres. These
 * cases prove the import path enforces write roles, account visibility, strict
 * money parsing, balance side effects, and audit coverage.
 */

import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  accounts,
  auditLogs,
  householdMembers,
  households,
  merchants,
  transactions,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
  getTestApp,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

type HouseholdRole = "owner" | "admin" | "member" | "view_only";

interface SeededMember {
  householdId: string;
  userId: string;
  email: string;
  cookie: string;
}

describe("Import execute REAL-DB integration (W1)", () => {
  let app: Express;
  const trackedHouseholdIds = new Set<string>();
  const trackedUserIds = new Set<string>();

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(async () => {
    for (const householdId of trackedHouseholdIds) {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(merchants).where(eq(merchants.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
    }

    for (const userId of trackedUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }

    trackedHouseholdIds.clear();
    trackedUserIds.clear();
  });

  async function seedMember(options?: {
    role?: HouseholdRole;
    householdId?: string;
    householdName?: string;
  }): Promise<SeededMember> {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const user = createTestUser({
      email: `import-w1-${stamp}@example.com`,
      username: `import-w1-${stamp}`,
    });
    user.passwordHash = await hashPassword("TestPassword123");
    trackedUserIds.add(user.id);

    let householdId = options?.householdId;
    if (!householdId) {
      const household = createTestHousehold(user.id, {
        name: options?.householdName ?? `Import W1 ${stamp}`,
        currency: "ZMW",
      });
      householdId = household.id;
      trackedHouseholdIds.add(household.id);
      await db.insert(households).values({
        id: household.id,
        name: household.name,
        currency: household.currency,
      });
    }

    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId: user.id,
      role: options?.role ?? "admin",
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "TestPassword123" })
      .expect(200);
    const cookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    return { householdId, userId: user.id, email: user.email, cookie };
  }

  async function seedAccount(options: {
    householdId: string;
    ownerUserId?: string;
    isPrivate?: boolean;
    balance?: string;
    name?: string;
  }): Promise<string> {
    const accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId: options.householdId,
      ownerUserId: options.ownerUserId,
      name: options.name ?? `Import Account ${accountId.slice(0, 8)}`,
      type: "checking",
      balance: options.balance ?? "1000.00",
      initialBalance: options.balance ?? "1000.00",
      currency: "ZMW",
      isAsset: true,
      isPrivate: options.isPrivate ?? false,
    });
    return accountId;
  }

  function importBody(params: {
    targetAccountId: string;
    strategy?: "prioritize_coppercoin" | "prioritize_csv";
    rows?: Record<string, string>[];
  }) {
    return {
      targetAccountId: params.targetAccountId,
      strategy: params.strategy ?? "prioritize_coppercoin",
      mapping: {
        date: "Date",
        amount: "Amount",
        merchant: "Merchant",
        description: "Description",
      },
      categoryMapping: {},
      rows:
        params.rows ??
        [{ Date: "2026-01-10", Amount: "-12.34", Merchant: "Shop" }],
    };
  }

  it("rejects view-only members before importing or mutating balances", async () => {
    const member = await seedMember({ role: "view_only" });
    const accountId = await seedAccount({ householdId: member.householdId });

    const response = await request(app)
      .post("/api/import/execute")
      .set("Cookie", member.cookie)
      .send(importBody({ targetAccountId: accountId }));

    expect(response.status).toBe(403);

    const persisted = await db
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, member.householdId));
    expect(persisted).toHaveLength(0);

    const [account] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(account.balance).toBe("1000.00");
  });

  it("treats another household member's private target account as not found", async () => {
    const importer = await seedMember({ role: "admin" });
    const accountOwner = await seedMember({
      role: "member",
      householdId: importer.householdId,
    });
    const privateAccountId = await seedAccount({
      householdId: importer.householdId,
      ownerUserId: accountOwner.userId,
      isPrivate: true,
    });

    const response = await request(app)
      .post("/api/import/execute")
      .set("Cookie", importer.cookie)
      .send(importBody({ targetAccountId: privateAccountId }));

    expect(response.status).toBe(404);

    const persisted = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, privateAccountId));
    expect(persisted).toHaveLength(0);
  });

  it("reports malformed money by row while importing valid rows through the balance pipeline", async () => {
    const importer = await seedMember({ role: "admin" });
    const accountId = await seedAccount({
      householdId: importer.householdId,
      balance: "100.00",
    });

    const response = await request(app)
      .post("/api/import/execute")
      .set("Cookie", importer.cookie)
      .send(
        importBody({
          targetAccountId: accountId,
          rows: [
            { Date: "2026-01-10", Amount: "12abc", Merchant: "Bad Amount" },
            { Date: "2026-01-11", Amount: "(50.25)", Merchant: "Valid Shop" },
          ],
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        imported: 1,
        skipped: 0,
        deleted: 0,
        errors: [
          expect.objectContaining({
            rowIndex: 1,
            field: "amount",
          }),
        ],
      }),
    );

    const persisted = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual(
      expect.objectContaining({
        type: "expense",
        amount: "50.25",
        source: "csv_import",
      }),
    );

    const [account] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(account.balance).toBe("49.75");
  });

  it("overwrites only caller-visible rows, reverses balances, soft-deletes, and audits the batch", async () => {
    const importer = await seedMember({ role: "admin" });
    const otherMember = await seedMember({
      role: "member",
      householdId: importer.householdId,
    });
    const accountId = await seedAccount({
      householdId: importer.householdId,
      balance: "935.00",
    });
    const visibleTransactionId = randomUUID();
    const privateTransactionId = randomUUID();

    await db.insert(transactions).values([
      {
        id: visibleTransactionId,
        householdId: importer.householdId,
        accountId,
        ownerUserId: importer.userId,
        date: "2026-01-10",
        name: "Visible Existing",
        amount: "25.00",
        currency: "ZMW",
        type: "expense",
        isPrivate: false,
        source: "manual",
      },
      {
        id: privateTransactionId,
        householdId: importer.householdId,
        accountId,
        ownerUserId: otherMember.userId,
        date: "2026-01-10",
        name: "Private Existing",
        amount: "40.00",
        currency: "ZMW",
        type: "expense",
        isPrivate: true,
        source: "manual",
      },
    ]);

    const response = await request(app)
      .post("/api/import/execute")
      .set("Cookie", importer.cookie)
      .send(
        importBody({
          targetAccountId: accountId,
          strategy: "prioritize_csv",
          rows: [
            { Date: "2026-01-10", Amount: "-10.00", Merchant: "New Import" },
          ],
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        imported: 1,
        skipped: 0,
        deleted: 1,
        errors: [],
      }),
    );

    const [visible] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, visibleTransactionId));
    expect(visible.deletedAt).toBeInstanceOf(Date);

    const [privateRow] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, privateTransactionId));
    expect(privateRow.deletedAt).toBeNull();

    const [newImport] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.source, "csv_import"),
          isNull(transactions.deletedAt),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(1);
    expect(newImport).toEqual(
      expect.objectContaining({
        name: "New Import",
        amount: "10.00",
        type: "expense",
      }),
    );

    const [account] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(account.balance).toBe("950.00");

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.householdId, importer.householdId));

    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "DELETE",
          entityType: "transaction",
          entityId: visibleTransactionId,
          userId: importer.userId,
        }),
        expect.objectContaining({
          action: "CREATE",
          entityType: "transaction",
          entityId: newImport.id,
          userId: importer.userId,
        }),
        expect.objectContaining({
          action: "CREATE",
          entityType: "transaction_import",
          entityId: accountId,
          userId: importer.userId,
        }),
      ]),
    );
  });
});
