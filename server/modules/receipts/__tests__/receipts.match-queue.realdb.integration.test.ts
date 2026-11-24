/**
 * #14 review P2-2 (REAL DB): the receipts.match queue only takes receipts it
 * can match. A receipt with no OCR data returns before any attempt is counted,
 * so it would keep its due nextMatchAt forever; fifty abandoned uploads would
 * fill every daily batch and starve the receipts behind them.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pendingReceipts } from "@shared/schema";
import { db } from "../../../db";
import { receiptRepository } from "../../../repositories/ReceiptRepository";
import { a, actors, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const QUEUE_SCAN = 500;
const DUE_LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
const DUE_NOW = new Date(Date.now() - 60_000);

async function clean() {
  await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, a));
}

async function receipt(ocrData: { amount: string; date: string } | null, nextMatchAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(pendingReceipts).values({
    id, householdId: a, uploadedBy: actors.get("owner")!.id, filename: `${id}.png`, originalFilename: "r.png",
    mimeType: "image/png", size: 10, storagePath: `receipts/${id}.png`,
    ocrStatus: ocrData ? "completed" : "pending", ocrData, matchStatus: "pending", nextMatchAt,
  });
  return id;
}

describe("receipts.match queue skips receipts with no OCR data (#14 P2-2, real DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });

  it("returns a due receipt with OCR data and leaves out the older ones without it", async () => {
    await receipt(null, DUE_LONG_AGO);
    await receipt(null, DUE_LONG_AGO);
    const matchable = await receipt({ amount: "25.00", date: "2026-11-10" }, DUE_NOW);

    const due = (await receiptRepository.findForMatching(QUEUE_SCAN)).filter((row) => row.householdId === a);

    expect(due.map((row) => row.id)).toEqual([matchable]);
  });
});
