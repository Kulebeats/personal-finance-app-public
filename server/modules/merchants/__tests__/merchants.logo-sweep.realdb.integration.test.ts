/**
 * Orphan merchant-logo sweep (cleanup.merchant-logos). A replaced or removed
 * logo keeps its file and merchant_logo_uploads row, because another merchant
 * may still show the same URL. The sweep retires a file only once no merchant
 * references it and its upload is older than the grace period; a file any
 * merchant still shows is never touched.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { merchantLogoUploads, merchants } from "@shared/schema";
import { db } from "../../../db";
import { createSignedHousehold, type SignedHousehold } from "../../../__tests__/signed-household-fixture";
import { sweepOrphanMerchantLogos } from "../merchants.logo-sweep";
import { SCHEDULED_JOBS } from "../../../core/scheduling/jobRegistry";

const DAY_MS = 24 * 60 * 60 * 1000;
let fx: SignedHousehold;
let logoDir: string;

async function storeLogo(merchantId: string, uploadedAt: Date): Promise<{ filePath: string; url: string }> {
  const storedFilename = `${randomUUID()}.png`;
  const filePath = path.posix.join("uploads", "merchant-logos", fx.householdId, storedFilename);
  await fs.writeFile(path.resolve(process.cwd(), filePath), Buffer.from("synthetic logo bytes"));
  await db.insert(merchantLogoUploads).values({
    merchantId, originalFilename: "logo.png", storedFilename, filePath,
    fileSize: 20, mimeType: "image/png", uploadedBy: fx.userId, uploadedAt,
  });
  return { filePath, url: `/${filePath}` };
}

const fileExists = (filePath: string) =>
  fs.stat(path.resolve(process.cwd(), filePath)).then(() => true, () => false);

async function rowExists(filePath: string): Promise<boolean> {
  const rows = await db.select({ id: merchantLogoUploads.id }).from(merchantLogoUploads)
    .where(eq(merchantLogoUploads.filePath, filePath));
  return rows.length > 0;
}

describe("orphan merchant-logo sweep (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("logo-sweep");
    logoDir = path.resolve(process.cwd(), "uploads", "merchant-logos", fx.householdId);
    await fs.mkdir(logoDir, { recursive: true });
  }, 30000);

  afterAll(async () => {
    await fs.rm(logoDir, { recursive: true, force: true });
    if (fx) await fx.cleanup();
  });

  it("is registered as a scheduled cleanup job", () => {
    expect(SCHEDULED_JOBS.map((job) => job.name)).toContain("cleanup.merchant-logos");
  });

  it("removes an old unreferenced logo and keeps a referenced one and a recent one", async () => {
    const [shown] = await db.insert(merchants).values({ householdId: fx.householdId, name: "Synthetic Sweep Shown" })
      .returning({ id: merchants.id });
    const [copier] = await db.insert(merchants).values({ householdId: fx.householdId, name: "Synthetic Sweep Copier" })
      .returning({ id: merchants.id });
    const old = new Date(Date.now() - 3 * DAY_MS);
    const orphan = await storeLogo(shown.id, old);
    const current = await storeLogo(shown.id, old);
    const copied = await storeLogo(shown.id, old);
    const recentOrphan = await storeLogo(shown.id, new Date());
    await db.update(merchants).set({ logoUrl: current.url }).where(eq(merchants.id, shown.id));
    // A merge or edit copied this URL onto another merchant: still shown, so kept.
    await db.update(merchants).set({ logoUrl: copied.url }).where(eq(merchants.id, copier.id));

    const summary = await sweepOrphanMerchantLogos();

    expect(summary.removed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);
    expect([await fileExists(orphan.filePath), await rowExists(orphan.filePath)]).toEqual([false, false]);
    for (const kept of [current, copied, recentOrphan]) {
      expect([await fileExists(kept.filePath), await rowExists(kept.filePath)]).toEqual([true, true]);
    }
  });

  it("retires the upload row of an orphan whose file is already gone", async () => {
    const [merchant] = await db.insert(merchants).values({ householdId: fx.householdId, name: "Synthetic Sweep Missing" })
      .returning({ id: merchants.id });
    const missing = await storeLogo(merchant.id, new Date(Date.now() - 3 * DAY_MS));
    await fs.unlink(path.resolve(process.cwd(), missing.filePath));

    const summary = await sweepOrphanMerchantLogos();

    expect(summary.failed).toBe(0);
    expect(await rowExists(missing.filePath)).toBe(false);
  });
});
