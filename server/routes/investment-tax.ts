import { Router, Request, Response } from "express";
import { investmentTaxService } from "../services/InvestmentTaxService";
import { householdGuard } from "../middleware/householdGuard";
import { requireAuth } from "../auth";
import { analyticsLimiter } from "../middleware/rateLimit";
import { Parser } from "json2csv";
import { businessAuditService } from "../services/BusinessAuditService";
import { randomUUID } from "crypto";
import { can } from "../core/authz/capabilities";
import { ForbiddenError, ValidationError } from "../core/errors";
import { asyncHandler } from "../utils/errorHandler";
import { db } from "../db";
import { householdToday } from "../services/householdCalendarToday";
import { neutralizeCsvFormula } from "../core/csv";

const router = Router();
router.use(requireAuth);
router.use(householdGuard);
router.use(analyticsLimiter);

/** The household's current calendar year, not the host's or the browser's. */
async function householdYear(req: Request) {
  return Number((await householdToday(db, req.householdContext!.householdId)).slice(0, 4));
}

async function taxYear(req: Request) {
  // An omitted year is the household's current calendar year.
  const year = req.query.year === undefined ? await householdYear(req) : Number(req.query.year);
  if (!Number.isInteger(year) || year < 1000 || year >= 9999) throw new ValidationError("A valid tax year is required");
  return year;
}

// NEW-22: the report's default and latest selectable year (no financial data).
router.get("/year", asyncHandler(async (req: Request, res: Response) => {
  res.json({ year: await householdYear(req) });
}));

router.get("/summary", asyncHandler(async (req: Request, res: Response) => {
  const summary = await investmentTaxService.getTaxSummary(req.householdContext!, await taxYear(req));
  res.json(summary);
}));

router.get("/zra-export", asyncHandler(async (req: Request, res: Response) => {
  const actor = req.householdContext!;
  if (!can(actor.role, "financial.export")) throw new ForbiddenError("Financial export access required");
  const year = await taxYear(req), format = req.query.format === "json" ? "json" : "csv";

  // This source-free record describes the request, not private financial rows
  // or their count. Commit it before the final fresh protected financial read.
  await db.transaction(tx => businessAuditService.log({
    tx,
    userId: actor.userId, householdId: actor.householdId, action: "PROCESS", entityType: "data_export", entityId: randomUUID(),
    details: { exportType: "investment_tax_zra", fileFormat: format, year, phase: "requested" },
    ipAddress: businessAuditService.getIpAddress(req),
  }));
  const data = await investmentTaxService.getZraExport(actor, year);
  if (format === "json") return res.json(data);
  const parser = new Parser({ fields: ["date", "type", "security", "grossAmount", "whtPaid", "netAmount", "institution"] });
  // A-29: a security name is user-entered and `securities` is not household-scoped,
  // so every text cell is neutralized before a spreadsheet opens it. Amounts stay numeric.
  const rows = data.map(row => ({ ...row, date: neutralizeCsvFormula(row.date), type: neutralizeCsvFormula(row.type),
    security: neutralizeCsvFormula(row.security), institution: neutralizeCsvFormula(row.institution) }));
  res.header("Content-Type", "text/csv");
  res.attachment(`zra_tax_export_${year}.csv`);
  return res.send(parser.parse(rows));
}));

export default router;
