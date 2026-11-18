import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  apiErrorMiddleware,
  NotFoundError,
  ValidationError,
} from "../../utils/errorHandler";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const { mockReceiptService, mockBusinessAuditService } = vi.hoisted(() => ({
  mockReceiptService: {
    getPendingReceipts: vi.fn(),
    getReceipt: vi.fn(),
    uploadReceipt: vi.fn(),
    linkReceiptToTransaction: vi.fn(),
    deleteReceipt: vi.fn(),
    storeOcrResults: vi.fn(),
    attemptMatch: vi.fn(),
    createTransactionFromReceipt: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));

vi.mock("../../services/ReceiptService", () => ({
  receiptService: mockReceiptService,
}));

vi.mock("../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user-123" } as unknown as import("@shared/schema").User;
    req.session = { userId: "user-123" };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middleware/householdGuard", () => ({
  householdGuard: (req: any, _res: any, next: any) => {
    req.householdContext = {
      householdId: "11111111-1111-1111-1111-111111111111",
      userId: "user-123",
      role: "owner",
    };
    next();
  },
}));

vi.mock("../../middleware/rateLimit", () => ({
  generalLimiter: (_req: any, _res: any, next: any) => next(),
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Import router (uses the mocks above)
import receiptsRouter from "../../modules/receipts/receipts.routes";

const app = express();
app.use(express.json());
app.use("/api/receipts", receiptsRouter);

app.use(apiErrorMiddleware);

describe("Receipts Integration", () => {
  const householdId = "11111111-1111-1111-1111-111111111111";
  const receiptId = "22222222-2222-2222-2222-222222222222";
  const transactionId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/receipts", () => {
    it("returns pending receipts with pagination", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [{ id: receiptId }],
        total: 1,
      });

      const res = await request(app).get("/api/receipts");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.total).toBe(1);
      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        householdId,
        expect.objectContaining({ status: "pending" })
      );
    });

    it("returns 400 for invalid query parameters", async () => {
      const res = await request(app).get("/api/receipts?limit=500");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("passes search parameter to service", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [{ id: receiptId }],
        total: 1,
      });

      const res = await request(app).get("/api/receipts?search=target");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        householdId,
        expect.objectContaining({ search: "target" })
      );
    });

    it("passes status parameter to service", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [],
        total: 0,
      });

      const res = await request(app).get("/api/receipts?status=matched");

      expect(res.status).toBe(200);
      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        householdId,
        expect.objectContaining({ status: "matched" })
      );
    });

    it("passes pagination parameters to service", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [],
        total: 100,
      });

      const res = await request(app).get("/api/receipts?limit=10&offset=20");

      expect(res.status).toBe(200);
      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        householdId,
        expect.objectContaining({ limit: 10, offset: 20 })
      );
    });

    it("returns 400 for search string too long", async () => {
      const longSearch = "a".repeat(101);
      const res = await request(app).get(`/api/receipts?search=${longSearch}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/receipts/:id", () => {
    it("returns a receipt by id", async () => {
      mockReceiptService.getReceipt.mockResolvedValue({ id: receiptId });

      const res = await request(app).get(`/api/receipts/${receiptId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(receiptId);
    });

    it("returns 404 when receipt is missing", async () => {
      mockReceiptService.getReceipt.mockRejectedValue(
        new NotFoundError("Receipt not found")
      );

      const res = await request(app).get(`/api/receipts/${receiptId}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/receipts/upload", () => {
    it("uploads a receipt image", async () => {
      mockReceiptService.uploadReceipt.mockResolvedValue({
        receiptId,
        isDuplicate: false,
        duplicateOf: null,
      });

      const res = await request(app)
        .post("/api/receipts/upload")
        .set("x-idempotency-key", "idempotency-key-1")
        .attach("file", Buffer.from("fake-file"), "receipt.jpg");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receiptId).toBe(receiptId);
      expect(mockReceiptService.uploadReceipt).toHaveBeenCalled();
    });

    it("returns 400 when file is missing", async () => {
      const res = await request(app).post("/api/receipts/upload");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns duplicate response when receipt already exists", async () => {
      mockReceiptService.uploadReceipt.mockResolvedValue({
        receiptId,
        isDuplicate: true,
        duplicateOf: receiptId,
      });

      const res = await request(app)
        .post("/api/receipts/upload")
        .attach("file", Buffer.from("fake-file"), "receipt.jpg");

      expect(res.status).toBe(201);
      expect(res.body.data.isDuplicate).toBe(true);
      expect(res.body.data.duplicateOf).toBe(receiptId);
    });
  });

  describe("POST /api/receipts/:id/match", () => {
    it("links a receipt to a transaction", async () => {
      mockReceiptService.linkReceiptToTransaction.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/match`)
        .send({ transactionId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.matched).toBe(true);
    });

    it("returns 400 for invalid transaction id", async () => {
      const res = await request(app)
        .post(`/api/receipts/${receiptId}/match`)
        .send({ transactionId: "not-a-uuid" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 when receipt is missing", async () => {
      mockReceiptService.linkReceiptToTransaction.mockRejectedValue(
        new NotFoundError("Receipt not found")
      );

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/match`)
        .send({ transactionId });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when amount mismatch exceeds tolerance", async () => {
      mockReceiptService.linkReceiptToTransaction.mockRejectedValue(
        new ValidationError("Amount mismatch: receipt shows 50.00 but transaction is 45.00", [
          {
            field: "amount",
            message: "receipt 50.00 vs transaction 45.00 (tolerance 1.00)",
            code: "AMOUNT_MISMATCH",
          },
        ])
      );

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/match`)
        .send({ transactionId });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Amount mismatch");
    });

    it("accepts skipAmountValidation flag to override amount check", async () => {
      mockReceiptService.linkReceiptToTransaction.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/match`)
        .send({ transactionId, skipAmountValidation: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockReceiptService.linkReceiptToTransaction).toHaveBeenCalledWith(
        receiptId,
        transactionId,
        householdId,
        "user-123",
        { skipAmountValidation: true }
      );
    });

    it("passes skipAmountValidation=false when not provided", async () => {
      mockReceiptService.linkReceiptToTransaction.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/match`)
        .send({ transactionId });

      expect(res.status).toBe(200);
      expect(mockReceiptService.linkReceiptToTransaction).toHaveBeenCalledWith(
        receiptId,
        transactionId,
        householdId,
        "user-123",
        { skipAmountValidation: false }
      );
    });
  });

  describe("POST /api/receipts/:id/ocr-results", () => {
    it("stores OCR results and attempts auto-match", async () => {
      mockReceiptService.storeOcrResults.mockResolvedValue({
        matched: false,
      });

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/ocr-results`)
        .send({
          merchantName: "Test Store",
          amount: "12.34",
          date: "2024-01-02",
          confidence: 0.8,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ocrStored).toBe(true);
    });

    it("returns 400 for invalid OCR date", async () => {
      const res = await request(app)
        .post(`/api/receipts/${receiptId}/ocr-results`)
        .send({
          merchantName: "Test Store",
          amount: "12.34",
          date: "2024-02-30",
          confidence: 0.8,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 when receipt is missing", async () => {
      mockReceiptService.storeOcrResults.mockRejectedValue(
        new NotFoundError("Receipt not found")
      );

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/ocr-results`)
        .send({
          merchantName: "Test Store",
          amount: "12.34",
          date: "2024-01-02",
          confidence: 0.8,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns auto-match details when matched", async () => {
      mockReceiptService.storeOcrResults.mockResolvedValue({
        matched: true,
        transactionId,
      });

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/ocr-results`)
        .send({
          merchantName: "Test Store",
          amount: "12.34",
          date: "2024-01-02",
          confidence: 0.8,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.autoMatched).toBe(true);
      expect(res.body.data.matchedTransactionId).toBe(transactionId);
    });
  });

  describe("POST /api/receipts/:id/retry-match", () => {
    it("retries matching and returns result", async () => {
      mockReceiptService.attemptMatch.mockResolvedValue({
        matched: false,
        transactionId: null,
      });

      const res = await request(app).post(
        `/api/receipts/${receiptId}/retry-match`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.matched).toBe(false);
    });

    it("returns 404 when receipt is missing", async () => {
      mockReceiptService.attemptMatch.mockRejectedValue(
        new NotFoundError("Receipt not found")
      );

      const res = await request(app).post(
        `/api/receipts/${receiptId}/retry-match`
      );

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/receipts/:id/create-transaction", () => {
    it("creates a transaction from a receipt", async () => {
      mockReceiptService.createTransactionFromReceipt.mockResolvedValue({
        transactionId,
      });

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/create-transaction`)
        .send({
          accountId: "44444444-4444-4444-4444-444444444444",
          name: "Receipt Transaction",
          amount: "45.67",
          date: "2024-01-03",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactionId).toBe(transactionId);
    });

    it("returns 400 for invalid date", async () => {
      const res = await request(app)
        .post(`/api/receipts/${receiptId}/create-transaction`)
        .send({
          accountId: "44444444-4444-4444-4444-444444444444",
          name: "Receipt Transaction",
          amount: "45.67",
          date: "2024-02-30",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 when receipt is missing", async () => {
      mockReceiptService.createTransactionFromReceipt.mockRejectedValue(
        new NotFoundError("Receipt not found")
      );

      const res = await request(app)
        .post(`/api/receipts/${receiptId}/create-transaction`)
        .send({
          accountId: "44444444-4444-4444-4444-444444444444",
          name: "Receipt Transaction",
          amount: "45.67",
          date: "2024-01-03",
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /api/receipts/:id", () => {
    it("deletes a receipt", async () => {
      mockReceiptService.getReceipt.mockResolvedValue({
        id: receiptId,
        originalFilename: "receipt.jpg",
      });
      mockReceiptService.deleteReceipt.mockResolvedValue(undefined);

      const res = await request(app).delete(`/api/receipts/${receiptId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
    });

    it("returns 400 when receipt is matched", async () => {
      mockReceiptService.getReceipt.mockResolvedValue({
        id: receiptId,
        originalFilename: "receipt.jpg",
      });
      mockReceiptService.deleteReceipt.mockRejectedValue(
        new ValidationError("Cannot delete matched receipt")
      );

      const res = await request(app).delete(`/api/receipts/${receiptId}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 when receipt is missing", async () => {
      mockReceiptService.deleteReceipt.mockRejectedValue(
        new NotFoundError("Receipt not found")
      );

      const res = await request(app).delete(`/api/receipts/${receiptId}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
