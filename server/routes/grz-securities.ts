import { listVisibleBills, listVisibleBonds } from "../services/grz/holdingVisibility";
import { Router } from "express";
import { recordBillSchema, recordBondSchema } from "../services/grz/acquisition";
import { db } from "../db";
import {
  accounts,
  grzBonds,
  grzTBills,
  grzBondPayments,
} from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  generateBondSchedule,
  calculateTBillResults,
} from "../services/grz-service";
import { transactionService } from "../services/TransactionService";
import { householdGuard } from "../middleware/householdGuard";
import { requireRole } from "../middleware/validateEntity";
import { requireAuth } from "../auth";
import { Money } from "../core/money";
import { isValidDateString } from "../utils/dateUtils";
import { householdToday } from "../services/householdCalendarToday";
import { withTransaction } from "../utils/withTransaction";
import { businessAuditService } from "../services/BusinessAuditService";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../core/errors";
import { success, created } from "../core/http";
import { grzBondDto, grzPaymentDto, grzTBillDto } from "../services/grz/grzDto";
import { GRZ_POLICY_DEFAULTS } from "../services/grz/grzPolicyDefaults";
import { asyncHandler } from "../utils/errorHandler";
import { GRZ_COUPON_CURRENCY, lockCouponPayment, lockGrzSettlementAccounts, lockGrzWriter } from "../services/grz/couponPaymentAccess";
import { grzCouponPaymentKey } from "../services/grz/couponPaymentKey";
import { settleGrzPrincipal } from "../services/grz/principalSettlement";
import { readLockedGrzPrincipalValuation } from "../services/grz/bondValuation";
import { sellGrzBond } from "../services/grz/bondSale";
import { confirmTBillReceipt } from "../services/grz/tbillSettlement";

const router = Router();

// SEC-AUTH-005: Apply authentication, rate limiting, and household isolation
router.use(requireAuth);
router.use(householdGuard);

// ============================================================================
// GRZ BONDS
// ============================================================================

// GET /api/grz/bonds - List all bonds
router.get(
  "/bonds",
  asyncHandler(async (req, res) => {
    const bonds = await listVisibleBonds(req.householdContext!);
    success(res, bonds.map(grzBondDto), 200, { policy: GRZ_POLICY_DEFAULTS });
  })
);

// POST /api/grz/bonds - Add a new bond
router.post(
  "/bonds",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { householdId, userId } = req.householdContext!;

    // Parse body
    const parseResult = recordBondSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        "Invalid bond data",
        parseResult.error.errors
      );
    }
    const data = parseResult.data;

    const newBond = await withTransaction(async (tx) => {
      const actor = await lockGrzWriter(tx, req.householdContext!);
      if (data.accountId) await lockGrzSettlementAccounts(tx, actor, null, data.accountId, "share", "Account");
      const [bond] = await tx.insert(grzBonds).values({ ...data, householdId }).returning();

      // Generate coupon schedule. SCP-311: pass decimals as strings (wrapped in Money).
      const schedule = generateBondSchedule(
        new Date(bond.purchaseDate),
        new Date(bond.maturityDate),
        bond.faceValue,
        bond.couponRate,
        {
          couponFrequency: bond.couponFrequency ?? undefined,
          firstCouponDate: bond.firstCouponDate
            ? new Date(bond.firstCouponDate)
            : undefined,
        }
      );

      if (schedule.length > 0) {
        await tx.insert(grzBondPayments).values(
          schedule.map((p) => {
            const grossMoney = new Money(p.amount);
            const taxMoney = new Money(p.withholdingTax);
            const netMoney = grossMoney.subtract(taxMoney);
            return {
              bondId: bond.id,
              paymentDate: p.paymentDate.toISOString().split("T")[0],
              grossAmount: p.amount,
              withholdingTax: p.withholdingTax,
              netAmount: netMoney.toString(),
              paymentType: p.paymentType,
              status: "scheduled" as const,
            };
          })
        );
      }

      // DPA audit (SCP-312): written inside the txn so a GRZ write is never unlogged
      await businessAuditService.logCreate({
        userId,
        householdId,
        entityType: "grz_bond",
        entityId: bond.id,
        newValue: {
          bondName: bond.bondName,
          faceValue: bond.faceValue,
          couponRate: bond.couponRate,
          purchaseDate: bond.purchaseDate,
          maturityDate: bond.maturityDate,
          scheduledPayments: schedule.length,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        tx,
      });

      return bond;
    });

    created(res, grzBondDto(newBond));
  })
);

// ============================================================================
// GRZ T-BILLS
// ============================================================================

// GET /api/grz/tbills - List all T-Bills
router.get(
  "/tbills",
  asyncHandler(async (req, res) => {
    const tbills = await listVisibleBills(req.householdContext!);
    success(res, tbills.map(grzTBillDto), 200, { policy: GRZ_POLICY_DEFAULTS });
  })
);

// PUT /api/grz/bonds/:id/sell - confirmed sale settles cash once (NEW-04, GRZ-03)
router.put(
  "/bonds/:id/sell",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const result = await sellGrzBond(req.householdContext!, req.params.id, req.body, businessAuditService.getIpAddress(req));
    success(res, result);
  })
);

// POST /api/grz/tbills
router.post(
  "/tbills",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { householdId, userId } = req.householdContext!;

    const parseResult = recordBillSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        "Invalid T-Bill data",
        parseResult.error.errors
      );
    }
    const data = parseResult.data;
    const calculations = calculateTBillResults(data.faceValue, data.purchasePrice, data.tenorDays);

    const newTBill = await withTransaction(async (tx) => {
      const actor = await lockGrzWriter(tx, req.householdContext!);
      // A-42: new T-bills must name an account eligible for settlement in the form.
      const settlement = await lockGrzSettlementAccounts(tx, actor, null, data.accountId, "share", "Account");
      if (settlement.currency !== "ZMW" || !settlement.isAsset || settlement.isArchived) {
        throw new ValidationError("A T-bill must mature into an active ZMW asset account");
      }
      const [tbill] = await tx.insert(grzTBills).values({ ...data, householdId,
        purchaseYield: String(calculations.annualizedYield), discountAmount: new Money(calculations.discount, "ZMW").toString(),
      }).returning();

      // DPA audit (SCP-312)
      await businessAuditService.logCreate({
        userId,
        householdId,
        entityType: "grz_tbill",
        entityId: tbill.id,
        newValue: {
          faceValue: tbill.faceValue,
          purchasePrice: tbill.purchasePrice,
          purchaseYield: tbill.purchaseYield,
          discountAmount: tbill.discountAmount,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        tx,
      });

      return tbill;
    });

    created(res, grzTBillDto(newTBill));
  })
);

// POST /api/grz/tbills/:id/confirm-receipt - the member confirms the bank credit (A-36)
router.post(
  "/tbills/:id/confirm-receipt",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const result = await confirmTBillReceipt(req.householdContext!, req.params.id, req.body, businessAuditService.getIpAddress(req));
    success(res, grzTBillDto(result.bill));
  })
);

// POST /api/grz/payments/:id/pay
const payAccountSchema = z.object({ accountId: z.string().uuid() }).passthrough();
router.post(
  "/payments/:id/pay",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    // NEW-33: a malformed account id is a client error, caught before any lookup.
    const parsedAccount = payAccountSchema.safeParse(req.body);
    if (!parsedAccount.success) throw new ValidationError("Account ID is required and must be a UUID", parsedAccount.error.errors);
    const { accountId } = parsedAccount.data;
    const { date } = req.body;

    const { householdId, userId } = req.householdContext!;

    // FIX AUTH-GRZ-ACC-001: Validate account ownership before processing payment
    const { accountRepository } = await import(
      "../repositories/AccountRepository"
    );
    const account = await accountRepository.findByIdWithVisibility(accountId, householdId, userId);
    if (!account) {
      throw new NotFoundError(
        "Account not found or does not belong to this household"
      );
    }

    // 1. Get the payment details
    const payment = await db.query.grzBondPayments.findFirst({
      where: eq(grzBondPayments.id, id),
      with: {
        bond: true,
      },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    if (payment.bond.householdId !== householdId) {
      throw new ForbiddenError();
    }

    if (payment.bond.accountId && payment.bond.accountId !== account.id &&
        !await accountRepository.findByIdWithVisibility(payment.bond.accountId, householdId, userId)) {
      throw new NotFoundError("Payment not found");
    }

    // NOTE: pre-flight only — this reads outside the transaction, so it cannot
    // be trusted to still hold by the time we write. The authoritative
    // already-paid guard is re-run under FOR UPDATE inside the transaction
    // below. This early throw only avoids the extra work in the common
    // (uncontended) case and preserves the existing conflict contract.
    if (payment.paymentType === "principal") {
      const result = await settleGrzPrincipal(req.householdContext!, payment.id, req.body,
        readLockedGrzPrincipalValuation, businessAuditService.getIpAddress(req));
      const settlement = { operationId: result.settlement.operationId, status: result.settlement.status,
        pendingReason: result.pendingReason, cashTransactionId: result.settlement.cashTransactionId };
      return res.status(result.pending ? 202 : 200).json({ success: true, data: { ...grzPaymentDto(result.payment), settlement } });
    }
    if (payment.status === "paid") {
      throw new ConflictError("Payment is already marked as paid");
    }

    if (date !== undefined && (typeof date !== "string" || !isValidDateString(date))) {
      throw new ValidationError("Payment date must be a valid calendar date");
    }
    const paymentDate: string = date ?? await householdToday(db, householdId);
    // SCP-311: keep the DB net-coupon decimal in Money so the ledger income value is exact.
    const netCouponMoney = new Money(payment.netAmount, GRZ_COUPON_CURRENCY);

    // 2. Create Transaction (Income)
    //
    // The posting transaction locks the grant, bond, payment and accounts. Its
    // payment-based key permits recovery if the later status update rolls back.
    const { transaction } = await transactionService.createTransaction(
      {
        accountId,
        amount: netCouponMoney.toString(),
        currency: GRZ_COUPON_CURRENCY,
        date: paymentDate,
        type: "income",
        name: `GRZ Coupon: ${payment.bond.bondName}`,
        // categoryId: ??? - Should be "Interest Income" or similar. Leaving null for now.
      },
      householdId,
      userId,
      grzCouponPaymentKey(payment.id),
      undefined,
      { couponPaymentId: payment.id },
    );

    // 3. Create Investment Transaction
    // Skipped: 'investmentTransactions' requires a valid 'securityId' from 'securities' table.
    // GRZ Bonds are in 'grz_bonds' table, so we can't link directly without refactoring schema.
    // We already linked to the main ledger via 'incomeTransactionId'.

    // 4. Update Payment status + DPA audit, atomic (SCP-312).
    // (The income transaction above is created by the shared transactionService,
    // which takes no external tx; the audit is atomic with the GRZ payment write.)
    const updated = await withTransaction(async (tx) => {
      const locked = await lockCouponPayment(tx, req.householdContext!, payment.id, transaction.id, account.id,
        date === undefined ? undefined : paymentDate);
      const scopeIds = Array.from(new Set([locked.posting.accountId, ...(locked.bond.accountId ? [locked.bond.accountId] : [])]));
      const privacy = await tx.select({ private: accounts.isPrivate }).from(accounts).where(inArray(accounts.id, scopeIds));
      const auditHouseholdId = !locked.bond.accountId || locked.posting.isPrivate || privacy.some(row => row.private) ? null : householdId;

      const [u] = await tx
        .update(grzBondPayments)
        .set({
          status: "paid",
          actualPaymentDate: locked.posting.date,
          incomeTransactionId: transaction.id,
        })
        .where(eq(grzBondPayments.id, id))
        .returning();

      await businessAuditService.log({
        userId,
        householdId: auditHouseholdId,
        action: "PROCESS",
        entityType: "grz_bond_payment",
        entityId: id,
        details: {
          bondName: locked.bond.bondName,
          ...locked.breakdown,
          incomeTransactionId: transaction.id,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        tx,
      });

      return u;
    });

    // The in-lock
    // guards inside the transaction, so a caller sees an identical contract
    // whether the duplicate pay was caught before the transaction or inside
    // it — only the timing differs, never the meaning.
    success(res, grzPaymentDto(updated));
  })
);

export default router;
