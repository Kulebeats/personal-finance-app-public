import { resolveRequestHousehold, readSessionPreconditions, assertHouseholdPrecondition } from "../core/authz/session-preconditions";
import { HttpError } from "../core/errors";
import { can } from "../core/authz/capabilities";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { importService } from "../services/ImportService";
import { previewImport } from "../services/import/preview";
import { ImportAdmissionError } from "../services/import/admission";
import { MAX_IMPORT_CELL_ISSUES, type ImportOptions } from "../services/import/types";
import { householdRepository } from "../repositories/HouseholdRepository";
import { accountRepository } from "../repositories/AccountRepository";
import { requireAuth } from "../auth";
import { householdGuard } from "../middleware/householdGuard";
import { logger } from "../utils/logger";
import { validateUploadMiddleware } from "../middleware/fileValidation";
import { analyticsLimiter, uploadLimiter } from "../middleware/rateLimit";
import { importJson } from "../middleware/importBody";
import { businessAuditService } from "../services/BusinessAuditService";
import { IMPORT_DATE_FORMATS } from "@shared/import-date";
import { detectImportFormat, IMPORT_MAX_ROWS, parseXlsxImport, type ParsedImportFile } from "../services/import/spreadsheet";
import { buildCsvTemplate, buildXlsxTemplate } from "../services/import/template";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEMPLATE_FILE_NAME = "transactions-import-template";
/** A number cell expands to at most 400 characters, so its leading-zero display is bounded too. */
const MAX_REFERENCE_DISPLAY_LENGTH = 1024;
// A-02: the reviewed "CSV wins" removals (one per ledger row in the statement range) are bounded too.
const REVIEWED_REMOVALS_MAX = 20_000;

function targetRequired(res: Response) {
  return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Target account is required" } });
}

// SEC-VALID-004: Zod schema for import execute request
const importMappingSchema = z.object({
  date: z.string().min(1),
  // IMP-01: a signed Amount column, or Debit and/or Credit columns.
  // The wizard sends "" for a skipped column, as for the other optional fields.
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  currency: z.string().optional(),
  merchant: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  account: z.string().optional(),
  // NEW-17: Notes was dropped here by Zod's key stripping; reference is the D13 provider identity.
  notes: z.string().optional(),
  reference: z.string().optional(),
}).refine(mapping => Boolean(mapping.amount || mapping.debit || mapping.credit), {
  message: "Map an Amount column, or Debit and/or Credit columns", path: ["amount"],
});

// Excel sheet names are at most 31 characters.
const parseRequestSchema = z.object({ sheet: z.string().min(1).max(31).optional() });

/**
 * An optional array whose length is checked before any entry is parsed, so an
 * over-long body costs one issue, not one per entry (final pass P1).
 */
function boundedArray<T extends z.ZodTypeAny>(entry: T, max: number) {
  const withinLength = z.custom<unknown[]>(value => Array.isArray(value) && value.length <= max,
    { message: `Expected an array of at most ${max} entries` });
  return withinLength.pipe(z.array(entry)).default([]);
}

const importRequestSchema = z.object({
  householdId: z.string().uuid().optional(),
  targetAccountId: z.string().uuid().optional(),
  strategy: z.enum(["prioritize_coppercoin", "prioritize_csv"]),
  mapping: importMappingSchema,
  dateFormat: z.enum(IMPORT_DATE_FORMATS).default("auto"),
  categoryMapping: z.record(z.string()).default({}),
  rows: z
    .array(z.record(z.string()))
    .min(1, "At least one row required")
    .max(IMPORT_MAX_ROWS, `Cannot import more than ${IMPORT_MAX_ROWS} rows`),
  // IMP-01 review r4: Excel cell issues from /parse, carried beside the rows (Excel caps a cell at 32767 characters).
  cellIssues: boundedArray(z.object({
    row: z.number().int().min(1).max(IMPORT_MAX_ROWS),
    column: z.string().max(32767),
    issue: z.string().max(200),
    field: z.literal("reference").optional(),
  }), MAX_IMPORT_CELL_ISSUES),
  // IMP-01 review r6: leading-zero displays of the column mapped as Reference, one per row at most.
  referenceDisplays: boundedArray(z.object({
    row: z.number().int().min(1).max(IMPORT_MAX_ROWS),
    column: z.string().max(32767),
    text: z.string().max(MAX_REFERENCE_DISPLAY_LENGTH),
  }), IMPORT_MAX_ROWS),
});

/** A-01 / R2-01: a reviewed candidate decision names the ledger row it was shown against. */
const candidateDecisionsSchema = z.array(z.object({
  ordinal: z.number().int().min(1).max(IMPORT_MAX_ROWS), candidateId: z.string().uuid(),
}).strict()).max(IMPORT_MAX_ROWS).default([]);

const executeImportSchema = importRequestSchema.extend({
  // One id per reviewed file: a lost response is retried with the same id.
  batchId: z.string().uuid().optional(),
  // Ordinals (1-based data rows) the user confirmed as duplicates in the preview.
  skipRowOrdinals: z.array(z.number().int().min(1).max(IMPORT_MAX_ROWS)).max(IMPORT_MAX_ROWS).default([]),
  // A-02: the rows the preview showed this "CSV wins" import removing; execute deletes no others.
  reviewedRemovals: z.array(z.object({ id: z.string().uuid(), version: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
    .max(REVIEWED_REMOVALS_MAX).default([]),
  // A-01: candidates the user chose to import, each naming the ledger row the preview showed it against.
  postRows: candidateDecisionsSchema,
  // R2-01: candidates the user chose to skip, bound to the ledger row the preview showed, exactly like postRows.
  skipRows: candidateDecisionsSchema,
  // R2 P2: the account currency the preview showed (ISO 4217); a different currency at execute is a 409.
  previewCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  fileName: z.string().max(255).optional(),
});

type ImportTarget = Pick<ImportOptions, "userId" | "householdId" | "targetAccountId" | "accountCurrency">;

const router = Router();

// Configure multer with file size limit (10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// SEC-AUTH-002: authentication and household isolation on ALL import routes; the
// app-wide general API quota also covers them. Uploads and executions use the hourly
// upload budget. The read-only preview re-runs whenever the user changes the
// account or strategy, so it is limited per minute instead of spending that budget.
router.use(requireAuth);
router.use(householdGuard);

// POST /api/import/parse - Parse uploaded CSV
router.post(
  "/parse",
  uploadLimiter,
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

      const fields = parseRequestSchema.safeParse(req.body ?? {});
      if (!fields.success) return sendValidationError(res, fields.error);
      const result: ParsedImportFile = detectImportFormat(req.file.buffer, req.file.originalname) === "xlsx"
        ? parseXlsxImport(req.file.buffer, fields.data.sheet)
        : { format: "csv", ...(await importService.parseCsv(req.file.buffer)) };

      logger.info("Import file parse completed", {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
        format: result.format,
        rowCount: result.rows?.length || 0,
        formulaCells: result.formulaCells,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500) {
        return res.status(error.statusCode).json(error.toJSON());
      }
      logger.error(
        "CSV Parse Error",
        {
          requestId: req.requestId,
          userId: req.session.userId?.substring(0, 8) + "...",
        },
        error as Error
      );
      res.status(500).json({ message: "Unable to parse import file" });
    }
  }
);

/**
 * Session user, financial-write membership and a visible target account.
 * Responds and returns undefined when the request may not proceed.
 */
async function resolveImportTarget(req: Request, res: Response, body: { householdId?: string; targetAccountId?: string }): Promise<ImportTarget | undefined> {
  // FIX AUTH-IMPORT-002: ALWAYS use session userId, never accept from request body
  const effectiveUserId = req.session.userId;
  if (!effectiveUserId) {
    res.status(401).json({ message: "Unauthorized" });
    return undefined;
  }

  const userHousehold = await resolveRequestHousehold(req, effectiveUserId);
  if (!userHousehold) {
    res.status(404).json({ message: "Household not found" });
    return undefined;
  }

  const targetHouseholdId = body.householdId ?? userHousehold.id;
  const membership = await householdRepository.findMember(targetHouseholdId, effectiveUserId);
  if (!membership || !can(membership.role, "financial.write")) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Financial write access required" } });
    return undefined;
  }
  assertHouseholdPrecondition(readSessionPreconditions(req), targetHouseholdId);

  // FIX AUTH-IMPORT-001: Validate target account belongs to the household
  let accountCurrency: string | undefined;
  if (body.targetAccountId) {
    const account = await accountRepository.findByIdWithVisibility(body.targetAccountId, targetHouseholdId, effectiveUserId);
    accountCurrency = account?.currency ?? undefined;
    if (!account) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Target account not found or does not belong to this household" },
      });
      return undefined;
    }
  }
  return { userId: effectiveUserId, householdId: targetHouseholdId, targetAccountId: body.targetAccountId, accountCurrency };
}

function sendValidationError(res: Response, error: z.ZodError) {
  return res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "Invalid import data", details: error.errors },
  });
}

function handleImportError(req: Request, res: Response, error: unknown, label: string) {
  if (error instanceof ImportAdmissionError || (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500)) {
    return res.status(error.statusCode).json(error.toJSON());
  }
  logger.error(label, { requestId: req.requestId, userId: req.session.userId?.substring(0, 8) + "..." }, error as Error);
  res.status(500).json({ message: "Unable to execute import" });
}

// GET /api/import/template.csv and /template.xlsx - IMP-01 downloadable templates
router.get("/template.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${TEMPLATE_FILE_NAME}.csv"`);
  res.send(buildCsvTemplate());
});

router.get("/template.xlsx", (_req, res) => {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${TEMPLATE_FILE_NAME}.xlsx"`);
  res.send(buildXlsxTemplate());
});

// POST /api/import/preview - Read-only: chosen date format, identities, duplicate candidates (NEW-17)
router.post("/preview", analyticsLimiter, importJson, async (req, res) => {
  try {
    const parseResult = importRequestSchema.safeParse(req.body);
    if (!parseResult.success) return sendValidationError(res, parseResult.error);
    const { householdId, targetAccountId, rows, ...rest } = parseResult.data;
    const target = await resolveImportTarget(req, res, { householdId, targetAccountId });
    if (!target) return;
    if (!targetAccountId) return targetRequired(res);
    res.json(await previewImport(rows, { ...rest, ...target, targetAccountId }));
  } catch (error) {
    handleImportError(req, res, error, "Import Preview Error");
  }
});

// POST /api/import/execute - Execute import
router.post("/execute", uploadLimiter, importJson, async (req, res) => {
  try {
    // SEC-VALID-004: Validate request body with Zod
    const parseResult = executeImportSchema.safeParse(req.body);
    if (!parseResult.success) return sendValidationError(res, parseResult.error);

    const { householdId, targetAccountId, strategy, mapping, dateFormat, categoryMapping, rows,
      batchId, skipRowOrdinals, reviewedRemovals, postRows, skipRows, previewCurrency, fileName, cellIssues,
      referenceDisplays } = parseResult.data;
    // Auth, write access and the household expectation come first; then the currency check and the
    // ledger write both need the real target (review r4 P1).
    const target = await resolveImportTarget(req, res, { householdId, targetAccountId });
    if (!target) return;
    if (!targetAccountId) return targetRequired(res);

    logger.info("Import execution started", {
      requestId: req.requestId,
      userId: target.userId.substring(0, 8) + "...",
      householdId: target.householdId.substring(0, 8) + "...",
      rowCount: rows.length,
      strategy,
    });

    const result = await importService.executeImport(rows, {
      ...target,
      strategy,
      mapping,
      dateFormat,
      categoryMapping,
      batchKey: batchId,
      skipRowOrdinals,
      reviewedRemovals,
      postRows,
      skipRows,
      previewCurrency,
      fileName,
      cellIssues,
      referenceDisplays,
      ipAddress: getRequestIpAddress(req),
    });

    logger.info("Import execution completed", {
      requestId: req.requestId,
      userId: target.userId.substring(0, 8) + "...",
      importId: result.importId,
      replayed: result.replayed,
      imported: result.imported,
      duplicate: result.duplicate,
      skipped: result.skipped,
    });

    res.json(result);
  } catch (error) {
    handleImportError(req, res, error, "Import Execution Error");
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
