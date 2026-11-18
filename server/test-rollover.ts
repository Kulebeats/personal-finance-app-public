import { investmentAutomationService } from "./services/InvestmentAutomationService";
import { db } from "./db";
import {
  recurringInvestments,
  investmentTransactions,
  grzTBills,
  securities,
  accounts,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  console.log("🚀 Starting T-Bill Rollover Test...");

  const today = new Date().toISOString().split("T")[0];

  // 1. Setup Data
  const account = await db.query.accounts.findFirst();
  if (!account) throw new Error("No account found");

  // Create a T-Bill that matures TODAY
  const [oldBill] = await db
    .insert(grzTBills)
    .values({
      householdId: account.householdId,
      accountId: account.id,
      tbillName: "Old 91-Day Bill",
      faceValue: "1000.00",
      purchasePrice: "900.00",
      tenorDays: 91,
      purchaseDate: "2025-01-01",
      maturityDate: today, // MATURING TODAY
      status: "active",
    })
    .returning();

  console.log(
    `✅ Created maturing bill: ${oldBill.id} (FV: ${oldBill.faceValue})`
  );

  // Target generic security
  const targetSecurity = await db.query.securities.findFirst({
    where: eq(securities.symbol, "GRZ-182D"),
  });

  if (!targetSecurity) throw new Error("GRZ-182D seed missing");

  // Create Rollover Plan due TODAY
  const [plan] = await db
    .insert(recurringInvestments)
    .values({
      householdId: account.householdId,
      accountId: account.id,
      securityId: targetSecurity.id,
      type: "rollover",
      frequency: "monthly", // Irrelevant for one-off test
      amount: "1000.00", // Re-investing the Face Value
      currency: "ZMW",
      nextExecutionDate: today,
      isActive: true,
    })
    .returning();

  console.log(`✅ Created Rollover Plan: ${plan.id}`);

  // 2. Run Automation: MATURITY
  console.log("🔄 Processing Maturities...");
  const maturityRes =
    await investmentAutomationService.processTBillMaturities();
  console.log("maturities:", maturityRes);

  if (maturityRes.matured < 1) throw new Error("Failed to mature bill");

  // Verify Cash Credited - find a sell/maturity transaction for today
  const liquidityTx = await db.query.investmentTransactions.findFirst({
    where: and(
      eq(investmentTransactions.accountId, account.id),
      eq(investmentTransactions.type, "maturity"),
      eq(investmentTransactions.transactionDate, today)
    ),
  });
  if (!liquidityTx) throw new Error("Liquidity transaction missing");
  console.log("✅ Cash Credited via Maturity Payout");

  // 3. Run Automation: ROLLOVER
  console.log("🔄 Processing Rollovers...");
  const execRes = await investmentAutomationService.processDueInvestments();
  console.log("executions:", execRes);

  if (execRes.success < 1) throw new Error("Failed to execute rollover");

  // Verify New Bill
  const newBill = await db.query.grzTBills.findFirst({
    where: eq(grzTBills.tbillName, `Auto-Rollover: ${targetSecurity.name}`),
  });

  if (!newBill) throw new Error("New T-Bill not created");
  console.log(
    `✅ New T-Bill Created: ${newBill.id} (Tenor: ${newBill.tenorDays})`
  );

  // Cleanup
  await db
    .delete(recurringInvestments)
    .where(eq(recurringInvestments.id, plan.id));
  await db.delete(grzTBills).where(eq(grzTBills.id, oldBill.id));
  await db.delete(grzTBills).where(eq(grzTBills.id, newBill.id));
  await db
    .delete(investmentTransactions)
    .where(eq(investmentTransactions.id, liquidityTx.id));

  console.log("✨ Test Success!");
}

main().catch(console.error);
