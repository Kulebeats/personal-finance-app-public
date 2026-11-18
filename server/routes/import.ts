import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { importService } from "../services/ImportService";
import { householdRepository } from "../repositories/HouseholdRepository";
import { accountRepository } from "../repositories/AccountRepository";
import { requireAuth } from "../auth";
import { householdGuard } from "../middleware/householdGuard";
import { logger } from "../utils/logger";
import { validateUploadMiddleware } from "../middleware/fileValidation";
import { uploadLimiter } from "../middleware/rateLimit";
import { businessAuditService } from "../services/BusinessAuditService";

export const IMPORT_MAX_ROWS = 5000;

// SEC-VALID-004: Zod schema for import execute request
const importMappingSchema = z.object({
  date: z.string().min(1),
  amount: z.string().min(1),
  merchant: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  account: z.string().optional(),
});

const executeImportSchema = z.object({
  householdId: z.string().uuid().optional(),
  targetAccountId: z.string().uuid().optional(),
  strategy: z.enum(["prioritize_coppercoin", "prioritize_csv"]),
  mapping: importMappingSchema,
  categoryMapping: z.record(z.string()).default({}),
  rows: z
    .array(z.record(z.string()))
    .min(1, "At least one row required")
    .max(IMPORT_MAX_ROWS, `Cannot import more than ${IMPORT_MAX_ROWS} rows`),
});

const router = Router();

// Configure multer with file size limit (10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// SEC-AUTH-002: Apply authentication, household isolation, and rate limiting to ALL import routes
router.use(requireAuth);
router.use(householdGuard);
router.use(uploadLimiter);

// POST /api/import/parse - Parse uploaded CSV
router.post(
  "/parse",
  upload.single("file"),
  validateUploadMiddleware(),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      logger.info("CSV parse started", {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
        fileSize: req.file.size,
        fileName: req.file.originalname,
      });

      const result = await importService.parseCsv(req.file.buffer);

      logger.info("CSV parse completed", {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
        rowCount: result.rows?.length || 0,
      });

      res.json(result);
    } catch (error) {
      logger.error(
        "CSV Parse Error",
        {
          requestId: req.requestId,
          userId: req.session.userId?.substring(0, 8) + "...",
        },
        error as Error
      );
      res.status(500).json({ message: (error as Error).message });
    }
  }
);

// POST /api/import/execute - Execute import
router.post("/execute", async (req, res) => {
  try {
    // SEC-VALID-004: Validate request body with Zod
    const parseResult = executeImportSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid import data",
          details: parseResult.error.errors,
        },
      });
    }

    const {
      householdId,
      targetAccountId,
      strategy,
      mapping,
      categoryMapping,
      rows,
    } = parseResult.data;

    // FIX AUTH-IMPORT-002: ALWAYS use session userId, never accept from request body
    const effectiveUserId = req.session.userId;
    if (!effectiveUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userHousehold = await householdRepository.findByUserId(
      effectiveUserId
    );
    if (!userHousehold) {
      return res.status(404).json({ message: "Household not found" });
    }

    const targetHouseholdId = householdId ?? userHousehold.id;
    const membership = await householdRepository.findMember(
      targetHouseholdId,
      effectiveUserId
    );
    if (!membership || membership.role === "view_only") {
      return res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Import execution requires member access or higher",
        },
      });
    }

    // FIX AUTH-IMPORT-001: Validate target account belongs to the household
    if (targetAccountId) {
      const account = await accountRepository.findByIdWithVisibility(
        targetAccountId,
        targetHouseholdId,
        effectiveUserId
      );
      if (!account) {
        return res.status(404).json({
          success: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Target account not found or does not belong to this household",
          },
        });
      }
    }

    logger.info("Import execution started", {
      requestId: req.requestId,
      userId: effectiveUserId.substring(0, 8) + "...",
      householdId: targetHouseholdId.substring(0, 8) + "...",
      rowCount: rows.length,
      strategy,
    });

    const result = await importService.executeImport(rows, {
      userId: effectiveUserId,
      householdId: targetHouseholdId,
      targetAccountId,
      strategy,
      mapping,
      categoryMapping,
      ipAddress: getRequestIpAddress(req),
    });

    logger.info("Import execution completed", {
      requestId: req.requestId,
      userId: effectiveUserId.substring(0, 8) + "...",
      imported: result.imported,
      skipped: result.skipped,
    });

    res.json(result);
  } catch (error) {
    logger.error(
      "Import Execution Error",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res.status(500).json({ message: (error as Error).message });
  }
});

function getRequestIpAddress(req: Parameters<typeof businessAuditService.getIpAddress>[0]) {
  try {
    return businessAuditService.getIpAddress(req);
  } catch {
    return undefined;
  }
}

export default router;
