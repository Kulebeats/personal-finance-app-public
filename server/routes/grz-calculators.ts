import { Router } from "express";
import { z } from "zod";
import {
  calculateAccruedInterest,
  calculateBondPriceFromYield,
  calculateTBillYield,
  calculateYieldToMaturity,
} from "../services/grz-service";
import { householdGuard } from "../middleware/householdGuard";
import { requireRole } from "../middleware/validateEntity";
import { requireAuth } from "../auth";
import { generalLimiter } from "../middleware/rateLimit";

const router = Router();

const numeric = (schema: z.ZodNumber = z.number().finite()) =>
  z.preprocess((value) => (value === "" ? undefined : Number(value)), schema);

const bondPriceSchema = z.object({
  faceValue: numeric(z.number().positive()),
  couponRate: numeric(z.number().nonnegative()),
  yearsToMaturity: numeric(z.number().positive()),
  requiredYield: numeric(z.number().nonnegative()),
  frequency: numeric(z.number().int().positive()).optional(),
  accruedInterest: numeric(z.number().nonnegative()).optional(),
});

const ytmSchema = z.object({
  faceValue: numeric(z.number().positive()),
  couponRate: numeric(z.number().nonnegative()),
  yearsToMaturity: numeric(z.number().positive()),
  currentPrice: numeric(z.number().positive()),
  frequency: numeric(z.number().int().positive()).optional(),
});

const accruedSchema = z.object({
  faceValue: numeric(z.number().positive()),
  couponRate: numeric(z.number().nonnegative()),
  lastCouponDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayCountConvention: z.enum(["ACT/365", "ACT/360", "30/360"]).optional(),
});

const tbillYieldSchema = z.object({
  faceValue: numeric(z.number().positive()),
  discountRate: numeric(z.number().nonnegative()),
  tenorDays: numeric(z.number().int().positive()),
});

// SEC-AUTH-006: Apply authentication, rate limiting, and household isolation
router.use(requireAuth);
router.use(generalLimiter);
router.use(householdGuard);

router.post("/bond-price", requireRole("member"), (req, res) => {
  try {
    const data = bondPriceSchema.parse(req.body);
    const result = calculateBondPriceFromYield({
      faceValue: data.faceValue,
      couponRate: data.couponRate,
      yearsToMaturity: data.yearsToMaturity,
      requiredYield: data.requiredYield,
      frequency: data.frequency,
      accruedInterest: data.accruedInterest,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.post("/ytm", requireRole("member"), (req, res) => {
  try {
    const data = ytmSchema.parse(req.body);
    const result = calculateYieldToMaturity({
      faceValue: data.faceValue,
      couponRate: data.couponRate,
      yearsToMaturity: data.yearsToMaturity,
      currentPrice: data.currentPrice,
      frequency: data.frequency,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.post("/accrued", requireRole("member"), (req, res) => {
  try {
    const data = accruedSchema.parse(req.body);
    const result = calculateAccruedInterest({
      faceValue: data.faceValue,
      couponRate: data.couponRate,
      lastCouponDate: new Date(data.lastCouponDate),
      settlementDate: new Date(data.settlementDate),
      dayCountConvention: data.dayCountConvention,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.post("/tbill-yield", requireRole("member"), (req, res) => {
  try {
    const data = tbillYieldSchema.parse(req.body);
    const result = calculateTBillYield({
      faceValue: data.faceValue,
      discountRate: data.discountRate,
      tenorDays: data.tenorDays,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
