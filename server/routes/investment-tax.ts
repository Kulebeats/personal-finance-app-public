import { Router, Request, Response } from "express";
import { investmentTaxService } from "../services/InvestmentTaxService";
import { householdGuard } from "../middleware/householdGuard";
import { requireAuth } from "../auth";
import { analyticsLimiter } from "../middleware/rateLimit";
import { Parser } from "json2csv";
import { logger } from "../utils/logger";
import { businessAuditService } from "../services/BusinessAuditService";
import { randomUUID } from "crypto";

const router = Router();

// SEC-AUTH-003: Apply authentication, household isolation, and rate limiting
router.use(requireAuth);
router.use(householdGuard);
router.use(analyticsLimiter);

// GET /api/investments/tax/summary?year=2024
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const householdId = req.householdContext!.householdId;
    const year = Number(req.query.year) || new Date().getFullYear();

    const summary = await investmentTaxService.getTaxSummary(householdId, year);
    res.json(summary);
  } catch (error) {
    logger.error(
      "Error fetching tax summary",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ message: "Failed to fetch tax summary" });
  }
});

// GET /api/investments/tax/zra-export?year=2024&format=csv
router.get("/zra-export", async (req: Request, res: Response) => {
  try {
    const { householdId, userId } = req.householdContext!;
    const year = Number(req.query.year) || new Date().getFullYear();
    const format = req.query.format === "json" ? "json" : "csv";

    const data = await investmentTaxService.getZraExport(householdId, year);

    // DPA audit (Rule 9): this endpoint egresses financial + PII data (ZRA
    // withholding-tax export) - mirrors the reports CSV export's PROCESS/
    // data_export audit row. There is no persisted export record for this
    // single-shot endpoint, so a fresh id identifies the egress event itself.
    // Metadata only - never the exported rows.
    await businessAuditService.log({
      userId,
      householdId,
      action: "PROCESS",
      entityType: "data_export",
      entityId: randomUUID(),
      details: {
        exportType: "investment_tax_zra",
        fileFormat: format,
        year,
        recordCount: data.length,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    if (format === "json") {
      res.json(data);
    } else {
      // CSV Export
      const fields = [
        "date",
        "type",
        "security",
        "grossAmount",
        "whtPaid",
        "netAmount",
        "institution",
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(data);

      res.header("Content-Type", "text/csv");
      res.attachment(`zra_tax_export_${year}.csv`);
      res.send(csv);
    }
  } catch (error) {
    logger.error(
      "Error generating ZRA export",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ message: "Failed to generate export" });
  }
});

export default router;
