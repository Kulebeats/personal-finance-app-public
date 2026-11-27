import { Router } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { grzAuctionResults } from "@shared/schema";
import { householdGuard } from "../middleware/householdGuard";
import { requireRole } from "../middleware/validateEntity";
import { requireAuth } from "../auth";
import { businessAuditService } from "../services/BusinessAuditService";

const router = Router();

// SEC-AUTH-004: Apply authentication, rate limiting, and household isolation
router.use(requireAuth);
router.use(householdGuard);

const auctionResultSchema = z.object({
  auctionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  securityType: z.enum(["BOND", "TBILL"]),
  tenor: z.string().min(1).max(20),
  amountOffered: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format")
    .optional(),
  amountAccepted: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format")
    .optional(),
  weightedAvgYield: z.coerce.number().nonnegative().optional(),
  highestYield: z.coerce.number().nonnegative().optional(),
  lowestYield: z.coerce.number().nonnegative().optional(),
  weightedAvgDiscount: z.coerce.number().nonnegative().optional(),
});

const listResultsQuerySchema = z.object({
  securityType: z.enum(["BOND", "TBILL"]).optional(),
  tenor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const calendarQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).optional(),
});

// Yields/discounts are market statistics (ratios, not ledger money), but the
// persisted values should still be exact: Decimal rounding avoids the
// binary-float artifacts of formatting a raw number. The columns are
// decimal(6,4), so Postgres pads the stored value to 4 dp.
const toRateString = (value?: number): string | undefined =>
  value === undefined
    ? undefined
    : new Decimal(value).toDecimalPlaces(4).toString();

function getNextTuesday(from: Date) {
  const date = new Date(from);
  const day = date.getDay();
  const diff = (2 + 7 - day) % 7;
  if (diff === 0) {
    date.setDate(date.getDate() + 7);
  } else {
    date.setDate(date.getDate() + diff);
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

// GET /api/investments/grz/auctions/results
router.get("/auctions/results", async (req, res, next) => {
  try {
    const parsed = listResultsQuerySchema.parse(req.query);
    const conditions = [];

    if (parsed.securityType) {
      conditions.push(eq(grzAuctionResults.securityType, parsed.securityType));
    }
    if (parsed.tenor) {
      conditions.push(eq(grzAuctionResults.tenor, parsed.tenor));
    }

    const results = await db
      .select()
      .from(grzAuctionResults)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(grzAuctionResults.auctionDate))
      .limit(parsed.limit || 50);

    res.json({ success: true, data: results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    next(error);
  }
});

// POST /api/investments/grz/auctions/results
// FIX DATA-GRZ-001: Auction results are GLOBAL market data - admin-only write access
// Regular users can read but cannot write (prevents data contamination)
router.post("/auctions/results", requireRole("admin"), async (req, res, next) => {
  try {
    const data = auctionResultSchema.parse(req.body);
    const [result] = await db
      .insert(grzAuctionResults)
      .values({
        auctionDate: data.auctionDate,
        securityType: data.securityType,
        tenor: data.tenor,
        amountOffered: data.amountOffered,
        amountAccepted: data.amountAccepted,
        weightedAvgYield: toRateString(data.weightedAvgYield),
        highestYield: toRateString(data.highestYield),
        lowestYield: toRateString(data.lowestYield),
        weightedAvgDiscount: toRateString(data.weightedAvgDiscount),
        // No householdId - this is global public market data
      })
      .returning();

    // DPA audit (SCP-312). Auction results are global market data (no household),
    // so householdId is null and the actor is the admin who wrote it. Post-write
    // (non-tx) here to avoid touching the pre-existing yield formatting (SCP-321).
    await businessAuditService.logCreate({
      userId: req.householdContext!.userId,
      householdId: null,
      entityType: "grz_auction_result",
      entityId: result.id,
      newValue: {
        auctionDate: data.auctionDate,
        securityType: data.securityType,
        tenor: data.tenor,
        weightedAvgYield: data.weightedAvgYield,
        amountAccepted: data.amountAccepted,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    next(error);
  }
});

// GET /api/investments/grz/auctions/calendar
router.get("/auctions/calendar", async (req, res, next) => {
  try {
    const parsed = calendarQuerySchema.parse(req.query);
    const weeks = parsed.weeks || 12;
    const entries = [];

    let cursor = getNextTuesday(new Date());
    for (let i = 0; i < weeks; i++) {
      entries.push({
        date: cursor.toISOString().split("T")[0],
        note: "Estimated Tuesday auction",
        isEstimated: true,
      });
      cursor = getNextTuesday(new Date(cursor.getTime() + 24 * 60 * 60 * 1000));
    }

    res.json({ success: true, data: entries });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    next(error);
  }
});

// GET /api/investments/grz/yields/current
router.get("/yields/current", async (_req, res, next) => {
  try {
    const results = await db
      .select()
      .from(grzAuctionResults)
      .orderBy(desc(grzAuctionResults.auctionDate));

    const latest = new Map<string, (typeof results)[number]>();
    for (const row of results) {
      const key = `${row.securityType}:${row.tenor}`;
      if (!latest.has(key)) {
        latest.set(key, row);
      }
    }

    res.json({
      success: true,
      data: Array.from(latest.values()),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
