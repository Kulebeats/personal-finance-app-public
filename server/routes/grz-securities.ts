import { Router } from "express";
import { db } from "../db";
import {
  grzBonds,
  grzTBills,
  grzBondPayments,
  investmentTransactions,
  insertGrzBondSchema,
  insertGrzTBillSchema,
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  generateBondSchedule,
  calculateTBillResults,
} from "../services/grz-service";
import { transactionService } from "../services/TransactionService";
import { householdGuard } from "../middleware/householdGuard";
import { requireRole } from "../middleware/validateEntity";
import { requireAuth } from "../auth";
import { generalLimiter } from "../middleware/rateLimit";
import { Money } from "../core/money";
import Decimal from "decimal.js";
import { withTransaction } from "../utils/withTransaction";
import { businessAuditService } from "../services/BusinessAuditService";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../core/errors";
import { success, created } from "../core/http";
import { asyncHandler } from "../utils/errorHandler";
import { grzCouponPaymentKey } from "../services/grz/couponPaymentKey";

const router = Router();

// SEC-AUTH-005: Apply authentication, rate limiting, and household isolation
router.use(requireAuth);
router.use(generalLimiter);
router.use(householdGuard);

const sellBondSchema = z.object({
  soldDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  soldPrice: z.coerce.number().positive(),
  soldYield: z.coerce.number().nonnegative().optional(),
  accountId: z.string().uuid().optional(),
});

// ============================================================================
// GRZ BONDS
// ============================================================================

// GET /api/grz/bonds - List all bonds
router.get(
  "/bonds",
  asyncHandler(async (req, res) => {
    const { householdId } = req.householdContext!;

    const bonds = await db.query.grzBonds.findMany({
      where: eq(grzBonds.householdId, householdId),
      with: {
        payments: true,
      },
      orderBy: [desc(grzBonds.purchaseDate)],
    });

    success(res, bonds);
  })
);

// POST /api/grz/bonds - Add a new bond
router.post(
  "/bonds",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { householdId, userId } = req.householdContext!;

    // Parse body
    const parseResult = insertGrzBondSchema.safeParse({
      ...req.body,
      householdId,
    });
    if (!parseResult.success) {
      throw new ValidationError(
        "Invalid bond data",
        parseResult.error.errors
      );
    }
    const data = parseResult.data;

    // FIX AUTH-GRZ-ACC-001: Validate account ownership
    if (data.accountId) {
      const { accountRepository } = await import(
        "../repositories/AccountRepository"
      );
      const account = await accountRepository.findById(
        data.accountId,
        householdId
      );
      if (!account) {
        throw new NotFoundError(
          "Account not found or does not belong to this household"
        );
      }
    }

    const newBond = await withTransaction(async (tx) => {
      const [bond] = await tx.insert(grzBonds).values(data).returning();

      // Generate coupon schedule. SCP-311: pass decimals as strings (wrapped in Money).
      const schedule = generateBondSchedule(
        new Date(data.purchaseDate),
        new Date(data.maturityDate),
        data.faceValue,
        data.couponRate,
        {
          couponFrequency: data.couponFrequency || undefined,
          firstCouponDate: data.firstCouponDate
            ? new Date(data.firstCouponDate)
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

    created(res, newBond);
  })
);

// ============================================================================
// GRZ T-BILLS
// ============================================================================

// GET /api/grz/tbills - List all T-Bills
router.get(
  "/tbills",
  asyncHandler(async (req, res) => {
    const { householdId } = req.householdContext!;

    const tbills = await db.query.grzTBills.findMany({
      where: eq(grzTBills.householdId, householdId),
      orderBy: [desc(grzTBills.purchaseDate)],
    });

    success(res, tbills);
  })
);

// PUT /api/grz/bonds/:id/sell
router.put(
  "/bonds/:id/sell",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { householdId, userId } = req.householdContext!;
    const { id } = req.params;
    const parseResult = sellBondSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        "Invalid sell data",
        parseResult.error.errors
      );
    }
    const payload = parseResult.data;

    const bond = await db.query.grzBonds.findFirst({
      where: eq(grzBonds.id, id),
    });

    if (!bond) {
      throw new NotFoundError("Bond not found");
    }

    if (bond.householdId !== householdId) {
      throw new ForbiddenError();
    }

    // NOTE: this is a pre-flight check only — it reads outside the transaction,
    // so it cannot be trusted to be still true by the time we write. The
    // authoritative already-sold guard is re-run under FOR UPDATE inside the
    // transaction below. This early throw only avoids the extra work in the
    // common (uncontended) case and preserves the existing conflict contract.
    if (bond.status === "sold") {
      throw new ConflictError("Bond is already sold");
    }

    const soldDate = payload.soldDate || new Date().toISOString().split("T")[0];
    const accountId = bond.accountId || payload.accountId;

    if (!accountId) {
      throw new ValidationError("Account ID is required");
    }

    // FIX AUTH-GRZ-ACC-001: Validate account ownership before creating transaction
    const { accountRepository } = await import(
      "../repositories/AccountRepository"
    );
    const account = await accountRepository.findById(accountId, householdId);
    if (!account) {
      throw new NotFoundError(
        "Account not found or does not belong to this household"
      );
    }

    // SCP-311: sale proceeds via Money (exact ledger value); soldYield is a rate.
    const soldPriceStored = new Money(payload.soldPrice, "ZMW").toString();
    const soldYieldStored =
      payload.soldYield !== undefined
        ? new Decimal(payload.soldYield).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString()
        : null;

    const result = await withTransaction(async (tx) => {
      // CONCURRENCY (CLAUDE.md Rule 10): lock the bond row, then re-check its
      // state INSIDE the lock before writing.
      //
      // The status check above is a read-then-write TOCTOU: two concurrent sells
      // (a double-clicked button, a retried request) both read status='active',
      // both pass the check, and both proceed to write — flipping the bond to
      // 'sold' twice AND inserting TWO investment_transactions rows, so the same
      // bond's proceeds are booked to the ledger twice. The sale is not
      // idempotent, so the second one is pure phantom income.
      //
      // FOR UPDATE serializes the two transactions on this row: the second one
      // blocks until the first commits, then observes the committed
      // status='sold' and aborts without writing. The bond row already exists
      // here, so FOR UPDATE genuinely locks it (unlike a lock attempt on a
      // not-yet-inserted row, which would lock nothing — Postgres has no gap
      // locking).
      const [locked] = await tx
        .select()
        .from(grzBonds)
        .where(and(eq(grzBonds.id, id), eq(grzBonds.householdId, householdId)))
        .for("update")
        .limit(1);

      if (!locked) {
        throw new NotFoundError("Bond not found");
      }

      // Authoritative guard: re-read under the lock, so it reflects any sell a
      // concurrent request committed a moment ago.
      if (locked.status === "sold") {
        throw new ConflictError("Bond is already sold");
      }

      const [updated] = await tx
        .update(grzBonds)
        .set({
          status: "sold",
          soldDate,
          soldPrice: soldPriceStored,
          soldYield: soldYieldStored,
          updatedAt: new Date(),
        })
        .where(eq(grzBonds.id, id))
        .returning();

      const [investmentTx] = await tx
        .insert(investmentTransactions)
        .values({
          householdId,
          accountId,
          type: "sell",
          amount: soldPriceStored,
          currency: "ZMW",
          transactionDate: soldDate,
          notes: `GRZ Bond Sale: ${bond.bondName}${
            bond.isin ? ` (${bond.isin})` : ""
          }`,
        })
        .returning();

      // DPA audit (SCP-312)
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityType: "grz_bond",
        entityId: id,
        oldValue: { status: bond.status },
        newValue: {
          status: "sold",
          soldDate,
          soldPrice: updated.soldPrice,
        },
        metadata: { action: "sell", investmentTransactionId: investmentTx.id },
        ipAddress: businessAuditService.getIpAddress(req),
        tx,
      });

      return { updated, investmentTx };
    });

    // The pre-flight checks above throw the SAME error classes as the in-lock
    // guards inside the transaction, so a caller sees an identical contract
    // whether the duplicate sell was caught before the transaction or inside
    // it — only the timing differs, never the meaning.
    success(res, result);
  })
);

// POST /api/grz/tbills
router.post(
  "/tbills",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { householdId, userId } = req.householdContext!;

    // Calculate T-Bill metrics. SCP-311: money as strings (wrapped in Money); tenorDays is a count.
    const calculations = calculateTBillResults(
      String(req.body.faceValue),
      String(req.body.purchasePrice),
      Number(req.body.tenorDays)
    );

    const parseResult = insertGrzTBillSchema.safeParse({
      ...req.body,
      householdId,
      purchaseYield: String(calculations.annualizedYield),
      discountAmount: new Money(calculations.discount, "ZMW").toString(),
    });
    if (!parseResult.success) {
      throw new ValidationError(
        "Invalid T-Bill data",
        parseResult.error.errors
      );
    }
    const data = parseResult.data;

    // FIX AUTH-GRZ-ACC-001: Validate account ownership
    if (data.accountId) {
      const { accountRepository } = await import(
        "../repositories/AccountRepository"
      );
      const account = await accountRepository.findById(
        data.accountId,
        householdId
      );
      if (!account) {
        throw new NotFoundError(
          "Account not found or does not belong to this household"
        );
      }
    }

    const newTBill = await withTransaction(async (tx) => {
      const [tbill] = await tx.insert(grzTBills).values(data).returning();

      // DPA audit (SCP-312)
      await businessAuditService.logCreate({
        userId,
        householdId,
        entityType: "grz_tbill",
        entityId: tbill.id,
        newValue: {
          faceValue: data.faceValue,
          purchasePrice: data.purchasePrice,
          purchaseYield: data.purchaseYield,
          discountAmount: data.discountAmount,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        tx,
      });

      return tbill;
    });

    created(res, newTBill);
  })
);

// POST /api/grz/payments/:id/pay
router.post(
  "/payments/:id/pay",
  requireRole("member"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { accountId, date } = req.body;

    if (!accountId) {
      throw new ValidationError("Account ID is required");
    }

    const { householdId, userId } = req.householdContext!;

    // FIX AUTH-GRZ-ACC-001: Validate account ownership before processing payment
    const { accountRepository } = await import(
      "../repositories/AccountRepository"
    );
    const account = await accountRepository.findById(accountId, householdId);
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

    // NOTE: pre-flight only — this reads outside the transaction, so it cannot
    // be trusted to still hold by the time we write. The authoritative
    // already-paid guard is re-run under FOR UPDATE inside the transaction
    // below. This early throw only avoids the extra work in the common
    // (uncontended) case and preserves the existing conflict contract.
    if (payment.status === "paid") {
      throw new ConflictError("Payment is already marked as paid");
    }

    const paymentDate = date ? new Date(date) : new Date();
    // SCP-311: keep the DB net-coupon decimal in Money so the ledger income value is exact.
    const netCouponMoney = new Money(payment.netAmount ?? "0", "ZMW");

    // 2. Create Transaction (Income)
    //
    // CONCURRENCY (CLAUDE.md Rule 10): this ledger write happens BEFORE — and
    // outside — the payment-row lock below, because transactionService owns its
    // own transaction and takes no external tx. So the lock alone cannot stop
    // two concurrent pays from each booking an income row. The deterministic
    // idempotency key is what makes that impossible: both requests derive the
    // SAME uuidv5 from the payment id, and `transactions.idempotency_key` is a
    // UNIQUE column, so the loser's insert collides and returns the winner's
    // transaction (isDuplicate=true) rather than inserting a second coupon.
    //
    // Keyed on the payment id alone, deliberately: a scheduled coupon row is
    // payable exactly once, so its id fully identifies the ledger row it may
    // produce. It is NOT keyed on the date — `paymentDate` defaults to now(),
    // so two concurrent pays would derive different dates and a date-bearing key
    // would let both through, which is the very bug being closed.
    const { transaction } = await transactionService.createTransaction(
      {
        accountId,
        amount: netCouponMoney.toString(),
        date: paymentDate.toISOString().split("T")[0],
        type: "income",
        name: `GRZ Coupon: ${payment.bond.bondName}`,
        notes: `Coupon Payment for ${payment.bond.bondName}. Gross: ${payment.grossAmount}, WHT: ${payment.withholdingTax}`,
        // categoryId: ??? - Should be "Interest Income" or similar. Leaving null for now.
      },
      householdId,
      userId,
      grzCouponPaymentKey(id)
    );

    // 3. Create Investment Transaction
    // Skipped: 'investmentTransactions' requires a valid 'securityId' from 'securities' table.
    // GRZ Bonds are in 'grz_bonds' table, so we can't link directly without refactoring schema.
    // We already linked to the main ledger via 'incomeTransactionId'.

    // 4. Update Payment status + DPA audit, atomic (SCP-312).
    // (The income transaction above is created by the shared transactionService,
    // which takes no external tx; the audit is atomic with the GRZ payment write.)
    const updated = await withTransaction(async (tx) => {
      // CONCURRENCY (CLAUDE.md Rule 10): lock the payment row and re-check its
      // state INSIDE the lock before writing. The status check above is a
      // read-then-write TOCTOU: two concurrent pays (a double-clicked button, a
      // retried request) both read status='scheduled', both pass, and both write
      // — marking the coupon paid twice and emitting TWO audit rows.
      //
      // FOR UPDATE serializes them on this row: the loser blocks until the
      // winner commits, sees status='paid', and aborts without writing. The
      // payment row already exists here, so FOR UPDATE genuinely locks it
      // (Postgres has no gap locking — a lock on a not-yet-inserted row would
      // lock nothing).
      const [locked] = await tx
        .select()
        .from(grzBondPayments)
        .where(eq(grzBondPayments.id, id))
        .for("update")
        .limit(1);

      if (!locked) {
        throw new NotFoundError("Payment not found");
      }

      // Authoritative guard: re-read under the lock, so it reflects any pay a
      // concurrent request committed a moment ago.
      if (locked.status === "paid") {
        throw new ConflictError("Payment is already marked as paid");
      }

      const [u] = await tx
        .update(grzBondPayments)
        .set({
          status: "paid",
          actualPaymentDate: paymentDate.toISOString().split("T")[0],
          incomeTransactionId: transaction.id,
        })
        .where(eq(grzBondPayments.id, id))
        .returning();

      await businessAuditService.log({
        userId,
        householdId,
        action: "PROCESS",
        entityType: "grz_bond_payment",
        entityId: id,
        details: {
          bondName: payment.bond.bondName,
          grossAmount: payment.grossAmount,
          withholdingTax: payment.withholdingTax,
          netAmount: payment.netAmount,
          incomeTransactionId: transaction.id,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        tx,
      });

      return u;
    });

    // The pre-flight checks above throw the SAME error classes as the in-lock
    // guards inside the transaction, so a caller sees an identical contract
    // whether the duplicate pay was caught before the transaction or inside
    // it — only the timing differs, never the meaning.
    success(res, updated);
  })
);

export default router;
