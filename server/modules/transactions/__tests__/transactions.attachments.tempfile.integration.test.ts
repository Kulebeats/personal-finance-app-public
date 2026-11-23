/**
 * Transaction attachment temp-file hardening (W5a).
 *
 * Real-DB + real-HTTP coverage for the multipart upload path:
 * - attacker-controlled original filenames never become temp/final disk names
 * - multer temp files are removed after successful service processing
 * - multer temp files are removed if service processing fails after disk write
 *
 * @module modules/transactions/__tests__/transactions.attachments.tempfile.integration.test
 */

import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  accounts,
  householdMembers,
  households,
  transactionAttachments,
  transactions,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { isStored } from "../../../__tests__/stored-upload-fixture";
import { removeUploadObject } from "../../../core/storage/upload-objects";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const TEMP_UPLOAD_DIR = path.join(UPLOADS_ROOT, "temp");
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF_BUFFER = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
);

async function listRelativeFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  await walk(root, "");
  return files.sort();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("Transaction attachment temp-file hardening (W5a)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;
  let transactionId: string;
  const createdFiles: string[] = [];

  beforeAll(async () => {
    app = await getTestApp();

    const timestamp = Date.now();
    const testUser = createTestUser({
      email: `txn-attach-w5a-${timestamp}@example.com`,
      username: `txn-attach-w5a-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Transaction Attachment W5a Household",
      currency: "ZMW",
    });
    testUser.passwordHash = await hashPassword("TestPassword123");
    testUser.householdId = testHousehold.id;

    householdId = testHousehold.id;
    userId = testUser.id;

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });
    await db.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      passwordHash: testUser.passwordHash,
      fullName: testUser.fullName,
      emailVerified: testUser.emailVerified,
      mfaEnabled: testUser.mfaEnabled,
      failedLoginAttempts: testUser.failedLoginAttempts,
      lockedUntil: testUser.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId,
      role: "admin",
    });

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Attachment Test Checking",
      type: "checking",
      balance: "1000.00",
      currency: "ZMW",
      isAsset: true,
    });

    transactionId = randomUUID();
    await db.insert(transactions).values({
      id: transactionId,
      householdId,
      accountId,
      ownerUserId: userId,
      date: "2026-07-05",
      name: "Attachment test transaction",
      amount: "10.00",
      currency: "ZMW",
      type: "expense",
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    for (const filePath of createdFiles) {
      await removeUploadObject(filePath);
    }
    try {
      await fs.rm(path.join(UPLOADS_ROOT, "transactions", transactionId), {
        recursive: true,
        force: true,
      });
    } catch {
      /* ignore */
    }

    await db
      .delete(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, transactionId));
    await db.delete(transactions).where(eq(transactions.id, transactionId));
    await db.delete(accounts).where(eq(accounts.id, accountId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("stores hostile original filenames under generated MIME-derived names", async () => {
    const cases = [
      {
        originalname: "x.html",
        contentType: "image/png",
        body: PNG_BUFFER,
        expectedExt: ".png",
      },
      {
        originalname: "..\\..\\x",
        contentType: "application/pdf",
        body: PDF_BUFFER,
        expectedExt: ".pdf",
      },
      {
        originalname: "receipt.png.html",
        contentType: "image/png",
        body: PNG_BUFFER,
        expectedExt: ".png",
      },
    ] as const;

    for (const uploadCase of cases) {
      const tempBefore = await listRelativeFiles(TEMP_UPLOAD_DIR);
      const res = await request(app)
        .post(`/api/transactions/${transactionId}/attachments`)
        .set("Cookie", authCookie)
        .attach("file", uploadCase.body, {
          filename: uploadCase.originalname,
          contentType: uploadCase.contentType,
        })
        .expect(201);

      const attachmentId = res.body.data.id as string;
      const [attachment] = await db
        .select()
        .from(transactionAttachments)
        .where(eq(transactionAttachments.id, attachmentId))
        .limit(1);

      expect(attachment).toBeDefined();
      expect(attachment.filename).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|pdf)$/,
      );
      expect(attachment.filename.endsWith(uploadCase.expectedExt)).toBe(true);
      expect(attachment.filename).not.toContain("html");
      expect(attachment.filename).not.toContain("..");
      expect(attachment.filename).not.toContain("/");
      expect(attachment.filename).not.toContain("\\");
      expect(path.basename(attachment.storagePath)).toBe(attachment.filename);
      expect(await isStored(attachment.storagePath)).toBe(true);
      createdFiles.push(attachment.storagePath);

      await expect(listRelativeFiles(TEMP_UPLOAD_DIR)).resolves.toEqual(
        tempBefore,
      );
    }
  });

  it("removes the generated temp file when service processing fails", async () => {
    const tempBefore = await listRelativeFiles(TEMP_UPLOAD_DIR);
    const res = await request(app)
      .post(`/api/transactions/${randomUUID()}/attachments`)
      .set("Cookie", authCookie)
      .attach("file", PNG_BUFFER, {
        filename: "receipt.png.html",
        contentType: "image/png",
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    await expect(listRelativeFiles(TEMP_UPLOAD_DIR)).resolves.toEqual(
      tempBefore,
    );
  });
});
