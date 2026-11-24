/**
 * #14 review P2-1: the daily receipts.match run treats a refused link as an
 * unmatched attempt. A receipt whose uploader lost access (or whose candidate
 * transaction changed) is scheduled for retry and reaches no_match on the last
 * attempt, instead of failing the run every day and keeping readiness at
 * PARTIAL_FAILURE.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findForMatching: vi.fn(),
  findById: vi.fn(),
  findTransactionsForMatch: vi.fn(),
  updateUnmatchedReceipt: vi.fn(),
}));
vi.mock("../../../db", () => ({ db: {}, pool: {} }));
vi.mock("../../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../repositories/ReceiptRepository", () => ({ receiptRepository: repo }));

import { ForbiddenError } from "../../../utils/errorHandler";
import { receiptService } from "../index";
import { MAX_MATCH_ATTEMPTS } from "../matching";

const HOUSEHOLD = "11111111-1111-1111-1111-111111111111";
const RECEIPT = "22222222-2222-2222-2222-222222222222";
const UPLOADER = "44444444-4444-4444-4444-444444444444";
const OCR = { merchantName: "Synthetic Shop", amount: "25.00", date: "2026-11-10" };
const CANDIDATE = { id: "33333333-3333-3333-3333-333333333333", name: "Synthetic Shop", amount: "25.00", date: "2026-11-10" };

function queueWith(matchAttempts: number): void {
  const receipt = { id: RECEIPT, householdId: HOUSEHOLD, uploadedBy: UPLOADER, matchStatus: "pending",
    matchedTransactionId: null, ocrData: OCR, matchAttempts };
  repo.findForMatching.mockResolvedValue([receipt]);
  repo.findById.mockResolvedValue(receipt);
  repo.findTransactionsForMatch.mockResolvedValue([CANDIDATE]);
  repo.updateUnmatchedReceipt.mockResolvedValue(undefined);
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("receipts.match: a refused link is an unmatched attempt (#14 P2-1)", () => {
  it("schedules a retry instead of failing the run", async () => {
    queueWith(0);
    vi.spyOn(receiptService, "linkReceiptToTransaction").mockRejectedValue(new ForbiddenError("synthetic: no access"));

    await expect(receiptService.processMatchingQueue()).resolves.toEqual({ processed: 1, matched: 0, failed: 0 });

    expect(repo.updateUnmatchedReceipt).toHaveBeenCalledTimes(1);
    const [id, household, update] = repo.updateUnmatchedReceipt.mock.calls[0];
    expect([id, household]).toEqual([RECEIPT, HOUSEHOLD]);
    expect(update).toMatchObject({ matchAttempts: 1, nextMatchAt: expect.any(Date) });
    expect(update).not.toHaveProperty("matchStatus");
  });

  it("marks the receipt no_match on its last attempt", async () => {
    queueWith(MAX_MATCH_ATTEMPTS - 1);
    vi.spyOn(receiptService, "linkReceiptToTransaction").mockRejectedValue(new ForbiddenError("synthetic: no access"));

    await expect(receiptService.processMatchingQueue()).resolves.toEqual({ processed: 1, matched: 0, failed: 0 });

    expect(repo.updateUnmatchedReceipt.mock.calls[0][2]).toMatchObject({ matchStatus: "no_match", matchAttempts: MAX_MATCH_ATTEMPTS });
  });

  it("still counts an unexpected link error as a failed receipt", async () => {
    queueWith(0);
    vi.spyOn(receiptService, "linkReceiptToTransaction").mockRejectedValue(new Error("synthetic: database down"));

    await expect(receiptService.processMatchingQueue()).resolves.toEqual({ processed: 0, matched: 0, failed: 1 });
    expect(repo.updateUnmatchedReceipt).not.toHaveBeenCalled();
  });
});
