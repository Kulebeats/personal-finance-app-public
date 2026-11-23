import { beforeEach, expect, it, vi } from "vitest";
import type { HouseholdContext } from "../../../core/authz/implicit-household-context";
import { ReceiptUploadService } from "../upload.service";

const mocks = vi.hoisted(() => ({
  legacyReplay: vi.fn(), replay: vi.fn(), visibleByHash: vi.fn(), create: vi.fn(),
  validate: vi.fn(), put: vi.fn(), discard: vi.fn(), discardUnlessCommitted: vi.fn(),
  isDefiniteRollback: vi.fn(), rowCommitted: vi.fn(), findById: vi.fn(),
}));
vi.mock("../../../repositories/ReceiptRepository", () => ({ receiptRepository: {
  // The legacy lookup supplies a synthetic household-only hit if that path regresses.
  findByIdempotencyKey: mocks.legacyReplay, findUploadReplay: mocks.replay,
  findVisibleByImageHash: mocks.visibleByHash, create: mocks.create, findById: mocks.findById,
} }));
vi.mock("../image", () => ({
  validateFile: mocks.validate, calculateImageHash: () => "synthetic-hash",
  optimizeImage: (buffer: Buffer) => buffer, generateThumbnail: () => Buffer.from("thumbnail"),
}));
vi.mock("../matching", () => ({}));
vi.mock("../../../core/storage/upload-objects", () => ({
  putUploadObject: mocks.put, discardUploadObject: mocks.discard,
  discardUnlessCommitted: mocks.discardUnlessCommitted,
  isDefiniteRollback: mocks.isDefiniteRollback, rowCommitted: mocks.rowCommitted,
}));

const actor: HouseholdContext = { householdId: "synthetic-household", userId: "synthetic-member", role: "member" };
const key = "synthetic-upload-retry";
const upload = { buffer: Buffer.from("synthetic"), originalFilename: "receipt.png", mimeType: "image/png", size: 9 };
const conflict = new Error("Synthetic wrapped database refusal", {
  cause: { code: "23505", constraint: "pending_receipts_idempotency_key_unique" },
});
const service = new ReceiptUploadService();

beforeEach(() => { vi.resetAllMocks(); mocks.isDefiniteRollback.mockReturnValue(true); });

it("refuses an earlier receipt that the current actor cannot read, before validating or storing bytes", async () => {
  mocks.legacyReplay.mockResolvedValue({ id: "hidden-receipt" });
  mocks.replay.mockResolvedValue({ receiptId: null });

  await expect(service.uploadReceipt(upload, actor, key)).rejects.toMatchObject({ statusCode: 404, message: "Receipt not found" });
  expect(mocks.replay).toHaveBeenCalledWith(key, actor);
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(mocks.visibleByHash).not.toHaveBeenCalled();
  expect(mocks.put).not.toHaveBeenCalled();
});

it("returns a visible keyed retry before checking the image hash", async () => {
  mocks.legacyReplay.mockResolvedValue({ id: "visible-receipt" });
  mocks.replay.mockResolvedValue({ receiptId: "visible-receipt" });

  await expect(service.uploadReceipt(upload, actor, key)).resolves.toEqual({ receiptId: "visible-receipt", isDuplicate: true });
  expect(mocks.visibleByHash).not.toHaveBeenCalled();
  expect(mocks.put).not.toHaveBeenCalled();
});

it("discards both staged objects and returns a concurrently inserted visible receipt", async () => {
  mocks.create.mockRejectedValue(conflict);
  mocks.replay.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ receiptId: "visible-winner" });

  await expect(service.uploadReceipt(upload, actor, key)).resolves.toEqual({ receiptId: "visible-winner", isDuplicate: true });
  expect(mocks.replay.mock.calls).toEqual([[key, actor], [key, actor]]);
  expect(mocks.discard.mock.calls.map(([, purpose]) => purpose)).toEqual(["receipt", "receipt-thumbnail"]);
});

it.each([{ receiptId: null }, undefined])("discards staged objects when the key winner is unavailable: %j", async winner => {
  mocks.create.mockRejectedValue(conflict);
  mocks.replay.mockResolvedValueOnce(undefined).mockResolvedValueOnce(winner);

  await expect(service.uploadReceipt(upload, actor, key)).rejects.toMatchObject({ statusCode: 404, message: "Receipt not found" });
  expect(mocks.discard.mock.calls.map(([, purpose]) => purpose)).toEqual(["receipt", "receipt-thumbnail"]);
});

it("preserves ordinary error compensation for an unrelated unique constraint", async () => {
  const error = new Error("Synthetic receipt ID collision", { cause: { code: "23505", constraint: "pending_receipts_pkey" } });
  mocks.create.mockRejectedValue(error);

  await expect(service.uploadReceipt(upload, actor, key)).rejects.toBe(error);
  expect(mocks.discardUnlessCommitted.mock.calls.map(([, purpose]) => purpose)).toEqual(["receipt", "receipt-thumbnail"]);
});

it("keeps both objects if a lost insert reply is recovered by the generated receipt ID", async () => {
  mocks.create.mockRejectedValue(new Error("Synthetic lost reply"));
  mocks.isDefiniteRollback.mockReturnValue(false);
  mocks.rowCommitted.mockImplementation(async (exists: () => Promise<boolean>) => exists());
  mocks.findById.mockResolvedValue({});

  const result = await service.uploadReceipt(upload, actor, key);
  expect(result).toEqual({ receiptId: mocks.create.mock.calls[0][0].id, isDuplicate: false });
  expect(mocks.findById).toHaveBeenCalledWith(result.receiptId);
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(mocks.discardUnlessCommitted).not.toHaveBeenCalled();
});
