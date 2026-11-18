/**
 * Right-to-Erasure Disk File Cleanup — Real-DB Integration Tests (R13)
 *
 * Audit v2 finding D2: eraseAccount() deleted every database row for a
 * household but never removed the corresponding uploaded files from disk
 * (receipts, goal images, merchant logos, transaction attachments, the
 * erased user's profile banner) — leaving PII on disk after a Zambia DPA
 * erasure request.
 *
 * These tests seed one real file per covered upload category for a
 * to-be-erased (sole-member) household PLUS the same spread for a bystander
 * household, run the real eraseAccount() service against real Postgres and
 * the real filesystem, and assert:
 *   1. every file belonging to the erased household/user is gone from disk
 *   2. the bystander household's files are completely untouched (the
 *      critical safety property — erasure must never reach outside the
 *      household/user being erased)
 *   3. the erasure audit row is still written (unchanged behavior)
 *
 * RED→GREEN guard: against the unfixed service (before this file's
 * collect/delete wiring was added to eraseAccount), the erased household's
 * files remain on disk after erasure — see the RED evidence recorded in the
 * PR description. Restoring the fix turns this GREEN.
 *
 * Tests run via `cd server && vitest run <this file>` (per test:server:run),
 * so `process.cwd()` is `server/` and every file this test writes lands
 * under `server/uploads/...` — separate from the real dev/prod uploads
 * directory at the repo root. Cleaned up in afterAll regardless.
 *
 * @module modules/settings/__tests__/settings.account-deletion.files.db.integration.test
 */

import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../../../db";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
  transactionAttachments,
  merchants,
  merchantLogoUploads,
  goalImageUploads,
  pendingReceipts,
  auditLogs,
} from "@shared/schema";
import { createTestUser, createTestHousehold } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { eraseAccount } from "../settings.account-deletion.service";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "ErasureFilesTestPassword123";

interface UploadFixturePaths {
  goalImagePath: string;
  merchantLogoPath: string;
  attachmentPath: string;
  attachmentThumbPath: string;
  receiptPath: string;
  receiptThumbPath: string;
  bannerPath: string;
  profilePicturePath: string;
}

interface SeededHousehold {
  householdId: string;
  userId: string;
  userEmail: string;
  accountId: string;
  transactionId: string;
  merchantId: string;
  paths: UploadFixturePaths;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeDummyFile(relativeOrAbsolute: string): Promise<string> {
  const resolved = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(process.cwd(), relativeOrAbsolute);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, "dummy erasure fixture content");
  return resolved;
}

/**
 * Seed a sole-owner household with one real, on-disk file per covered
 * upload category (goal image, merchant logo, transaction attachment +
 * thumbnail, pending receipt + thumbnail) plus a banner file on the user
 * row, all wired through the DB rows/columns the real upload controllers
 * would have written.
 */
async function seedHouseholdWithUploads(
  label: string,
  passwordHash: string,
): Promise<SeededHousehold> {
  const testUser = createTestUser({
    email: `erasure-files-${label}@example.com`,
    username: `erasure-files-${label}`,
  });
  const testHousehold = createTestHousehold(testUser.id);
  const householdId = testHousehold.id;
  const userId = testUser.id;

  // Banner path/file (matches settings.banner.controller.ts's convention).
  const bannerFilename = `${randomUUID()}.png`;
  const bannerUrl = `/uploads/banners/${householdId}/${bannerFilename}`;
  const bannerPath = await writeDummyFile(
    path.join("uploads", "banners", householdId, bannerFilename),
  );

  // Profile-picture path/file (matches settings.picture.controller.ts's
  // convention: uploads/profile-pictures/{householdId}/{uuid}{ext}, URL on
  // users.profile_picture_url).
  const pictureFilename = `${randomUUID()}.png`;
  const profilePictureUrl = `/uploads/profile-pictures/${householdId}/${pictureFilename}`;
  const profilePicturePath = await writeDummyFile(
    path.join("uploads", "profile-pictures", householdId, pictureFilename),
  );

  await db.insert(households).values({
    id: householdId,
    name: `Erasure Files Household ${label}`,
    currency: "ZMW",
  });
  await db.insert(users).values({
    id: userId,
    email: testUser.email,
    username: testUser.username,
    passwordHash,
    fullName: `Erasure Files User ${label}`,
    emailVerified: true,
    bannerUrl,
    profilePictureUrl,
  });
  await db.insert(householdMembers).values({
    householdId,
    userId,
    role: "owner",
  });

  const accountId = randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    householdId,
    name: `Erasure Files Account ${label}`,
    type: "checking",
    balance: "1000.00",
    currency: "ZMW",
  });

  // Goal image upload (goals.images.controller.ts convention).
  const goalImageFilename = `${randomUUID()}.png`;
  const goalImageRelPath = path.join(
    "uploads",
    "goals",
    householdId,
    goalImageFilename,
  );
  const goalImagePath = await writeDummyFile(goalImageRelPath);
  await db.insert(goalImageUploads).values({
    householdId,
    originalFilename: "goal.png",
    storedFilename: goalImageFilename,
    filePath: goalImageRelPath,
    fileSize: 32,
    mimeType: "image/png",
    uploadedBy: userId,
  });

  // Merchant + merchant logo upload.
  const merchantId = randomUUID();
  await db.insert(merchants).values({
    id: merchantId,
    householdId,
    name: `Erasure Files Merchant ${label}`,
  });
  const merchantLogoFilename = `${randomUUID()}.png`;
  const merchantLogoRelPath = path.join(
    "uploads",
    "merchants",
    merchantId,
    merchantLogoFilename,
  );
  const merchantLogoPath = await writeDummyFile(merchantLogoRelPath);
  await db.insert(merchantLogoUploads).values({
    merchantId,
    originalFilename: "logo.png",
    storedFilename: merchantLogoFilename,
    filePath: merchantLogoRelPath,
    fileSize: 32,
    mimeType: "image/png",
    uploadedBy: userId,
  });

  // Transaction + attachment (AttachmentService.ts convention: absolute path).
  const transactionId = randomUUID();
  await db.insert(transactions).values({
    id: transactionId,
    householdId,
    accountId,
    name: `Erasure Files Transaction ${label}`,
    amount: "42.00",
    type: "expense",
    date: "2024-05-01",
    ownerUserId: userId,
  });
  const attachmentFilename = `${randomUUID()}.pdf`;
  const attachmentAbsPath = await writeDummyFile(
    path.join(
      process.cwd(),
      "uploads",
      "transactions",
      transactionId,
      attachmentFilename,
    ),
  );
  const attachmentThumbFilename = `${randomUUID()}_thumb.jpg`;
  const attachmentThumbPath = await writeDummyFile(
    path.join(
      process.cwd(),
      "uploads",
      "transactions",
      transactionId,
      attachmentThumbFilename,
    ),
  );
  await db.insert(transactionAttachments).values({
    transactionId,
    filename: attachmentFilename,
    originalFilename: "receipt.pdf",
    mimeType: "application/pdf",
    size: 32,
    storagePath: attachmentAbsPath,
    thumbnailPath: attachmentThumbPath,
    uploadedBy: userId,
  });

  // Pending receipt (receipt/upload.service.ts convention: relative path).
  const receiptId = randomUUID();
  const receiptFilename = `${receiptId}.jpg`;
  const receiptRelPath = path.join(
    "uploads",
    "receipts",
    householdId,
    receiptFilename,
  );
  const receiptPath = await writeDummyFile(receiptRelPath);
  const receiptThumbRelPath = path.join(
    "uploads",
    "receipts",
    householdId,
    `${receiptId}_thumb.jpg`,
  );
  const receiptThumbPath = await writeDummyFile(receiptThumbRelPath);
  await db.insert(pendingReceipts).values({
    id: receiptId,
    householdId,
    uploadedBy: userId,
    filename: receiptFilename,
    originalFilename: "receipt.jpg",
    mimeType: "image/jpeg",
    size: 32,
    storagePath: receiptRelPath,
    thumbnailPath: receiptThumbRelPath,
  });

  return {
    householdId,
    userId,
    userEmail: testUser.email,
    accountId,
    transactionId,
    merchantId,
    paths: {
      goalImagePath,
      merchantLogoPath,
      attachmentPath: attachmentAbsPath,
      attachmentThumbPath,
      receiptPath,
      receiptThumbPath,
      bannerPath,
      profilePicturePath,
    },
  };
}

async function cleanupHousehold(seed: SeededHousehold): Promise<void> {
  try {
    await db.delete(auditLogs).where(eq(auditLogs.userId, seed.userId));
    await db
      .delete(auditLogs)
      .where(eq(auditLogs.householdId, seed.householdId));
    await db
      .delete(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, seed.transactionId));
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, seed.householdId));
    await db
      .delete(merchantLogoUploads)
      .where(eq(merchantLogoUploads.merchantId, seed.merchantId));
    await db.delete(merchants).where(eq(merchants.id, seed.merchantId));
    await db
      .delete(goalImageUploads)
      .where(eq(goalImageUploads.householdId, seed.householdId));
    await db
      .delete(pendingReceipts)
      .where(eq(pendingReceipts.householdId, seed.householdId));
    await db
      .delete(accounts)
      .where(eq(accounts.householdId, seed.householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, seed.householdId));
    await db.delete(users).where(eq(users.id, seed.userId));
    await db.delete(households).where(eq(households.id, seed.householdId));
  } catch (error) {
    console.error("Cleanup error (ignored):", error);
  }

  for (const p of Object.values(seed.paths)) {
    await fs.unlink(p).catch(() => undefined);
  }
}

describe("Right-to-Erasure Disk File Cleanup (R13 / audit v2 finding D2)", () => {
  let erased: SeededHousehold;
  let bystander: SeededHousehold;
  const label = `${Date.now()}`;

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    erased = await seedHouseholdWithUploads(`erased-${label}`, passwordHash);
    bystander = await seedHouseholdWithUploads(
      `bystander-${label}`,
      passwordHash,
    );

    // Sanity: every fixture file really exists before erasure runs.
    for (const p of Object.values(erased.paths)) {
      expect(await fileExists(p), `fixture missing: ${p}`).toBe(true);
    }
    for (const p of Object.values(bystander.paths)) {
      expect(await fileExists(p), `fixture missing: ${p}`).toBe(true);
    }
  });

  afterAll(async () => {
    await cleanupHousehold(erased);
    await cleanupHousehold(bystander);
    // uploads/merchants has no other test writer; remove if now empty.
    await fs
      .rm(path.join(UPLOADS_ROOT, "merchants"), {
        recursive: true,
        force: true,
      })
      .catch(() => undefined);
  });

  it("deletes every on-disk file owned by the erased household/user and writes the erasure audit row", async () => {
    const result = await eraseAccount({
      userId: erased.userId,
      householdId: erased.householdId,
      userEmail: erased.userEmail,
      ipAddress: "127.0.0.1",
    });

    expect(result.householdDeleted).toBe(true);

    // ---- Erased household/user: every covered category is gone from disk ----
    expect(await fileExists(erased.paths.goalImagePath)).toBe(false);
    expect(await fileExists(erased.paths.merchantLogoPath)).toBe(false);
    expect(await fileExists(erased.paths.attachmentPath)).toBe(false);
    expect(await fileExists(erased.paths.attachmentThumbPath)).toBe(false);
    expect(await fileExists(erased.paths.receiptPath)).toBe(false);
    expect(await fileExists(erased.paths.receiptThumbPath)).toBe(false);
    expect(await fileExists(erased.paths.bannerPath)).toBe(false);
    expect(await fileExists(erased.paths.profilePicturePath)).toBe(false);

    // ---- Bystander household/user: completely untouched ----
    expect(await fileExists(bystander.paths.goalImagePath)).toBe(true);
    expect(await fileExists(bystander.paths.merchantLogoPath)).toBe(true);
    expect(await fileExists(bystander.paths.attachmentPath)).toBe(true);
    expect(await fileExists(bystander.paths.attachmentThumbPath)).toBe(true);
    expect(await fileExists(bystander.paths.receiptPath)).toBe(true);
    expect(await fileExists(bystander.paths.receiptThumbPath)).toBe(true);
    expect(await fileExists(bystander.paths.bannerPath)).toBe(true);
    expect(await fileExists(bystander.paths.profilePicturePath)).toBe(true);

    const [bystanderUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, bystander.userId));
    expect(bystanderUser.bannerUrl).not.toBeNull();
    expect(bystanderUser.profilePictureUrl).not.toBeNull();
    expect(bystanderUser.fullName).toContain("Erasure Files User");

    // ---- Erasure audit row is still written (unchanged behavior) ----
    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "user_account"),
          eq(auditLogs.entityId, erased.userId),
          eq(auditLogs.action, "DELETE"),
        ),
      );
    expect(auditRow).toBeDefined();
    expect(auditRow.userId).toBe(erased.userId);
  });
});
