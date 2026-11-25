/**
 * Receipts Module Integration Tests
 *
 * Covers: list, get, upload, match, OCR results, create transaction, delete.
 * Tests HTTP endpoints with mocked service layer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { receiptRow } from "./receipt-row.fixture";

// Hoist mocks
const mockReceiptService = vi.hoisted(() => ({
  getPendingReceipts: vi.fn(),
  getReceipt: vi.fn(),
  getVisibleReceipt: vi.fn(),
  uploadReceipt: vi.fn(),
  attemptMatch: vi.fn(),
  storeOcrResults: vi.fn(),
  createTransactionFromReceipt: vi.fn(),
  deleteReceipt: vi.fn(),
  linkReceiptToTransaction: vi.fn(),
}));

const mockBusinessAuditService = vi.hoisted(() => ({
  log: vi.fn().mockResolvedValue(undefined),
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("../../../services/ReceiptService", () => ({
  receiptService: mockReceiptService,
}));

vi.mock("../../receipts.service", () => ({
  receiptService: mockReceiptService,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (_req: any, _res: any, next: any) => next(),
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { receiptsController } from "../receipts.controller";

const TEST_HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const TEST_USER_ID = "22222222-2222-2222-2222-222222222222";
const TEST_RECEIPT_ID = "33333333-3333-3333-3333-333333333333";
const TEST_TRANSACTION_ID = "44444444-4444-4444-4444-444444444444";
const TEST_ACCOUNT_ID = "55555555-5555-5555-5555-555555555555";

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware
  app.use((req, _res, next) => {
    req.user = { id: TEST_USER_ID, email: "test@example.com" } as unknown as import("@shared/schema").User;
    req.session = { userId: TEST_USER_ID } as any;
    req.householdContext = {
      householdId: TEST_HOUSEHOLD_ID,
      userId: TEST_USER_ID,
      role: "owner",
    };
    next();
  });

  // Mount receipts routes
  const router = express.Router();
  router.get("/", receiptsController.list);
  router.get("/:id", receiptsController.getById);
  router.post("/:id/match", receiptsController.match);
  router.post("/:id/ocr-results", receiptsController.storeOcrResults);
  router.post("/:id/create-transaction", receiptsController.createTransaction);
  router.delete("/:id", receiptsController.delete);

  app.use("/api/receipts", router);

  // Error handler middleware - maps error names to status codes
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let statusCode = err.statusCode || err.status || 500;

    // Map error names to HTTP status codes
    if (err.name === "ValidationError") statusCode = 400;
    if (err.name === "NotFoundError") statusCode = 404;
    if (err.name === "UnauthorizedError") statusCode = 401;
    if (err.name === "ForbiddenError") statusCode = 403;
    if (err.name === "ConflictError") statusCode = 409;

    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || err.name || "INTERNAL_ERROR",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

describe("Receipts API Integration Tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // =========================================================================
  // GET /api/receipts - List receipts
  // =========================================================================
  describe("GET /api/receipts", () => {
    it("returns paginated receipts for household", async () => {
      const mockReceipts = [
        receiptRow({ id: TEST_RECEIPT_ID, originalFilename: "receipt1.jpg" }),
        receiptRow({ id: "receipt-2", originalFilename: "receipt2.jpg", matchStatus: "matched" }),
      ];

      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: mockReceipts,
        total: 2,
      });

      const response = await request(app)
        .get("/api/receipts")
        .query({ limit: 10, offset: 0 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: TEST_HOUSEHOLD_ID }),
        expect.objectContaining({ limit: 10, offset: 0 })
      );
    });

    it("returns empty array when no receipts", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [],
        total: 0,
      });

      const response = await request(app).get("/api/receipts").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.pagination.total).toBe(0);
    });

    it("filters by status when provided", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [],
        total: 0,
      });

      await request(app)
        .get("/api/receipts")
        .query({ status: "pending" })
        .expect(200);

      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: TEST_HOUSEHOLD_ID }),
        expect.objectContaining({ status: "pending" })
      );
    });

    it("filters by search when provided", async () => {
      mockReceiptService.getPendingReceipts.mockResolvedValue({
        receipts: [],
        total: 0,
      });

      await request(app)
        .get("/api/receipts")
        .query({ search: "grocery" })
        .expect(200);

      expect(mockReceiptService.getPendingReceipts).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: TEST_HOUSEHOLD_ID }),
        expect.objectContaining({ search: "grocery" })
      );
    });
  });

  // =========================================================================
  // GET /api/receipts/:id - Get receipt by ID
  // =========================================================================
  describe("GET /api/receipts/:id", () => {
    it("returns receipt when found", async () => {
      const mockReceipt = receiptRow({ id: TEST_RECEIPT_ID, ocrData: { amount: "99.99", merchantName: "Test Store" } });

      mockReceiptService.getVisibleReceipt.mockResolvedValue(mockReceipt);

      const response = await request(app)
        .get(`/api/receipts/${TEST_RECEIPT_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(TEST_RECEIPT_ID);
      expect(response.body.data.originalFilename).toBe("receipt.jpg");
      expect(response.body.data).not.toHaveProperty("storagePath");
    });

    it("returns 404 when receipt not found", async () => {
      mockReceiptService.getVisibleReceipt.mockRejectedValue(
        Object.assign(new Error("Receipt not found"), { statusCode: 404 })
      );

      const response = await request(app)
        .get("/api/receipts/nonexistent-id")
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it("returns 404 for receipt from different household", async () => {
      mockReceiptService.getVisibleReceipt.mockRejectedValue(
        Object.assign(new Error("Receipt not found"), { statusCode: 404 })
      );

      const response = await request(app)
        .get(`/api/receipts/${TEST_RECEIPT_ID}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // POST /api/receipts/:id/match - Match receipt to transaction
  // =========================================================================
  describe("POST /api/receipts/:id/match", () => {
    it("matches receipt to transaction successfully", async () => {
      mockReceiptService.linkReceiptToTransaction.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/match`)
        .send({ transactionId: TEST_TRANSACTION_ID })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockReceiptService.linkReceiptToTransaction).toHaveBeenCalledWith(
        TEST_RECEIPT_ID,
        TEST_TRANSACTION_ID,
        TEST_HOUSEHOLD_ID,
        TEST_USER_ID,
        expect.objectContaining({ skipAmountValidation: false })
      );
    });

    it("returns 400 when transactionId missing", async () => {
      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/match`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("returns 404 when receipt not found", async () => {
      mockReceiptService.linkReceiptToTransaction.mockRejectedValue(
        Object.assign(new Error("Receipt not found"), { statusCode: 404 })
      );

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/match`)
        .send({ transactionId: TEST_TRANSACTION_ID })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // POST /api/receipts/:id/ocr-results - Store OCR results
  // =========================================================================
  describe("POST /api/receipts/:id/ocr-results", () => {
    it("stores OCR results successfully", async () => {
      const ocrData = {
        amount: "125.50",
        merchantName: "Shoprite",
        date: "2026-01-15",
        currency: "ZMW",
        confidence: 0.95,
      };

      mockReceiptService.storeOcrResults.mockResolvedValue({
        id: TEST_RECEIPT_ID,
        ocrData,
        matchStatus: "pending",
      });

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/ocr-results`)
        .send(ocrData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockReceiptService.storeOcrResults).toHaveBeenCalled();
    });

    it("returns 400 for invalid OCR data (missing confidence)", async () => {
      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/ocr-results`)
        .send({ amount: "50.00" }) // Missing required confidence field
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("returns 404 when receipt not found", async () => {
      mockReceiptService.storeOcrResults.mockRejectedValue(
        Object.assign(new Error("Receipt not found"), { statusCode: 404 })
      );

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/ocr-results`)
        .send({ amount: "50.00", confidence: 0.8 })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // POST /api/receipts/:id/create-transaction - Create transaction from receipt
  // =========================================================================
  describe("POST /api/receipts/:id/create-transaction", () => {
    it("creates transaction from receipt successfully", async () => {
      const transactionData = {
        accountId: TEST_ACCOUNT_ID,
        amount: "150.00", // String format per validation schema
        date: "2026-01-20",
        name: "Grocery Shopping",
      };

      mockReceiptService.createTransactionFromReceipt.mockResolvedValue({
        transactionId: TEST_TRANSACTION_ID,
      });

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/create-transaction`)
        .send(transactionData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.transactionId).toBe(TEST_TRANSACTION_ID);
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("returns 400 when required fields missing", async () => {
      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/create-transaction`)
        .send({ name: "Test" }) // Missing accountId, amount, date
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("returns 404 when receipt not found", async () => {
      mockReceiptService.createTransactionFromReceipt.mockRejectedValue(
        Object.assign(new Error("Receipt not found"), { statusCode: 404 })
      );

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/create-transaction`)
        .send({
          accountId: TEST_ACCOUNT_ID,
          amount: "150.00",
          date: "2026-01-20",
          name: "Test",
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it("returns 409 when receipt already matched", async () => {
      mockReceiptService.createTransactionFromReceipt.mockRejectedValue(
        Object.assign(new Error("Receipt already matched"), { statusCode: 409 })
      );

      const response = await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/create-transaction`)
        .send({
          accountId: TEST_ACCOUNT_ID,
          amount: "150.00",
          date: "2026-01-20",
          name: "Test",
        })
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // DELETE /api/receipts/:id - Delete receipt
  // =========================================================================
  describe("DELETE /api/receipts/:id", () => {
    it("deletes pending receipt successfully", async () => {
      mockReceiptService.deleteReceipt.mockResolvedValue(undefined);

      const response = await request(app)
        .delete(`/api/receipts/${TEST_RECEIPT_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockReceiptService.deleteReceipt).toHaveBeenCalledWith(
        TEST_RECEIPT_ID,
        expect.objectContaining({ householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID }),
        "127.0.0.1",
      );
      expect(mockReceiptService.getReceipt).not.toHaveBeenCalled();
    });

    it("returns 404 when receipt not found", async () => {
      mockReceiptService.deleteReceipt.mockRejectedValue(
        Object.assign(new Error("Receipt not found"), { statusCode: 404 })
      );

      const response = await request(app)
        .delete(`/api/receipts/${TEST_RECEIPT_ID}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it("returns 409 when trying to delete matched receipt", async () => {
      mockReceiptService.deleteReceipt.mockRejectedValue(
        Object.assign(new Error("Cannot delete matched receipt"), {
          statusCode: 409,
        })
      );

      const response = await request(app)
        .delete(`/api/receipts/${TEST_RECEIPT_ID}`)
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // Audit Logging Tests
  // =========================================================================
  describe("Audit Logging", () => {
    it("passes the audit context to the receipt posting transaction", async () => {
      mockReceiptService.createTransactionFromReceipt.mockResolvedValue({
        transactionId: TEST_TRANSACTION_ID,
      });

      await request(app)
        .post(`/api/receipts/${TEST_RECEIPT_ID}/create-transaction`)
        .send({
          accountId: TEST_ACCOUNT_ID,
          amount: "150.00",
          date: "2026-01-20",
          name: "Test",
        })
        .expect(201);

      expect(mockReceiptService.createTransactionFromReceipt).toHaveBeenCalledWith(
        TEST_RECEIPT_ID, TEST_HOUSEHOLD_ID, expect.any(String),
        expect.objectContaining({ accountId: TEST_ACCOUNT_ID, amount: "150.00" }), { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("leaves the delete audit with the service that owns the write", async () => {
      mockReceiptService.deleteReceipt.mockResolvedValue(undefined);

      await request(app)
        .delete(`/api/receipts/${TEST_RECEIPT_ID}`)
        .expect(200);

      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });
});
