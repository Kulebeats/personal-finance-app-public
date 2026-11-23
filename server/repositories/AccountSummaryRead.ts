import { and, eq, inArray, sql } from "drizzle-orm";
import { grzBonds, grzTBills, holdings, households, pensionHoldings, securities } from "@shared/schema";
import { ACCOUNT_WEALTH_SCOPE, type AccountWealthSummary } from "@shared/account-summary";
import { isCurrencyCode } from "@shared/denomination";
import { canonicalAccountOwner } from "@shared/account-owner";
import { db } from "../db";
import { ConflictError, ForbiddenError } from "../core/errors";
import { CalculationError } from "../core/calculations/errors";
import { Money } from "../core/money";
import { portfolioValuationService } from "../services/PortfolioValuationService";
import { AccountFinancialDataUnavailable, readAccountActor, readVisibleAccounts } from "./AccountReadAudience";
import { readCapturedAccountHistory, applyCurrentCaptureCut } from "./AccountCapturedHistory";
import { accountQuoteProof, accountValuationRates, readAccountValuationQuotes } from "./AccountValuationFx";
import { accountListProjection } from "./AccountListProjection";
import { readAccountWealthPublication } from "./AccountWealthPublication";
import { outerBondId, bondCouponStateSql, bondMarketEvidenceSql, verifiedBondMarketValue } from "../services/grz/bondValuationEvidence";
import { householdSecurityPriceProjection } from "../services/investment/householdSecurityPriceRead";
import { addAccountToWealth, emptyWealthTotals, netWorthOf, type WealthTotals } from "../core/money/wealth-totals";
import { logger } from "../utils/logger";
import { heldTBillPredicate, tbillCarryingValue } from "../services/grz/tbillCarryingValue";
type SummaryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readInputs(tx: SummaryTransaction, actor: Awaited<ReturnType<typeof readAccountActor>>, asOf: Date) {
  const accounts = await readVisibleAccounts(tx, actor);
  const eligible = accounts.filter(account => account.isHidden === false && account.isArchived === false && account.excludeFromNetWorth === false);
  const ids = accounts.map(account => account.id);
  const holdingAccounts = accounts.filter(account => account.isHidden === false).map(account => account.id);
  const [household] = await tx.select({ currency: households.currency }).from(households).where(eq(households.id, actor.householdId));
  // Only positively attributed visible sources affect data or availability.
  // Unattributed/private/foreign sources never alter status, counts or warnings.
  const priceEvidence = householdSecurityPriceProjection({
    householdId: actor.householdId,
    securityId: securities.id,
    currency: securities.currency,
    globalReferencePrice: securities.currentPrice,
    valuationDate: sql`${asOf.toISOString().slice(0, 10)}::date`,
  });
  const capturedPositions = await tx.select({ holding: holdings, security: securities, priceEvidence }).from(holdings)
    .innerJoin(securities, eq(securities.id, holdings.securityId))
    .where(and(eq(holdings.householdId, actor.householdId), inArray(holdings.accountId, holdingAccounts))).orderBy(holdings.id);
  const positions = capturedPositions.map(row => ({
    ...row,
    security: { ...row.security, currentPrice: row.priceEvidence.currentPrice },
  }));
  const bills = await tx.select().from(grzTBills).where(and(eq(grzTBills.householdId, actor.householdId),
    heldTBillPredicate(), inArray(grzTBills.accountId, ids))).orderBy(grzTBills.id);
  const pensions = await tx.select().from(pensionHoldings).where(and(eq(pensionHoldings.householdId, actor.householdId), inArray(pensionHoldings.accountId, ids))).orderBy(pensionHoldings.id);
  const bonds = await tx.select({ bond: grzBonds, couponState: bondCouponStateSql(outerBondId),
    evidence: bondMarketEvidenceSql(outerBondId, asOf.toISOString().slice(0, 10)) }).from(grzBonds).where(and(eq(grzBonds.householdId, actor.householdId),
    eq(grzBonds.status, "active"), inArray(grzBonds.accountId, eligible.map(account => account.id)))).orderBy(grzBonds.id);
  const currencies = [...eligible.map(account => account.currency), ...positions.map(row => row.security.currency),
    ...(bills.length || pensions.length || bonds.length ? ["ZMW"] : [])].filter((value): value is string => typeof value === "string");
  const quotes = await readAccountValuationQuotes(tx, currencies, household?.currency, asOf);
  return { currency: household?.currency, asOf, quotes, accounts, positions, bills, pensions, bonds };
}
type Inputs = Awaited<ReturnType<typeof readInputs>>;

/** Compare valuation and authority, not unrelated notes, display order or timestamps. */
function financialProof(input: Inputs) {
  return {
    currency: input.currency,
    quotes: accountQuoteProof(input.quotes),
    accounts: input.accounts.map(account => ({ id: account.id, householdId: account.householdId, ownerUserId: account.ownerUserId,
      isPrivate: account.isPrivate, deletedAt: account.deletedAt, type: account.type, isAsset: account.isAsset,
      isHidden: account.isHidden, isArchived: account.isArchived, excluded: account.excludeFromNetWorth,
      balance: account.balance, estimatedValue: account.estimatedValue, currency: account.currency })).sort((a, b) => a.id.localeCompare(b.id)),
    positions: input.positions.map(({ holding, security, priceEvidence }) => ({ id: holding.id, householdId: holding.householdId, accountId: holding.accountId,
      securityId: security.id, quantity: holding.quantity, price: security.currentPrice, currency: security.currency, priceEvidence })),
    bills: input.bills.map(bill => ({ id: bill.id, householdId: bill.householdId, accountId: bill.accountId, status: bill.status, faceValue: tbillCarryingValue(bill) })),
    pensions: input.pensions.map(pension => ({ id: pension.id, householdId: pension.householdId, accountId: pension.accountId, balance: pension.currentBalance })),
    bonds: input.bonds.map(({ bond, couponState, evidence }) => ({ id: bond.id, householdId: bond.householdId, accountId: bond.accountId, status: bond.status,
      isin: bond.isin, faceValue: bond.faceValue, purchaseDate: bond.purchaseDate, maturityDate: bond.maturityDate, couponState, evidence })),
  };
}

type Rates = ReturnType<typeof accountValuationRates>;
type SummaryAccount = Inputs["accounts"][number];

const isEligibleForWealth = (account: SummaryAccount) => account.isHidden === false && account.isArchived === false && account.excludeFromNetWorth === false;

function accountBaseAmount(account: SummaryAccount, currency: string, rates: Rates): Money {
  const source = (account.type === "real_estate" || account.type === "vehicle") && account.estimatedValue !== null ? account.estimatedValue : account.balance;
  let amount: Money;
  try { amount = new Money(source, account.currency); }
  catch { throw new AccountFinancialDataUnavailable(); }
  if (!amount.amount.isFinite()) throw new AccountFinancialDataUnavailable();
  if (account.currency === currency) return amount;
  const rate = rates.get(account.currency);
  if (rate === undefined) throw new CalculationError("MISSING_FX_RATE", { from: account.currency, to: currency });
  return amount.multiply(rate);
}

/** Account balances only; liabilities are signed debt (see core/money/wealth-totals). */
function accountWealth(eligible: SummaryAccount[], currency: string, rates: Rates): WealthTotals {
  if (eligible.some(account => !isCurrencyCode(account.currency))) throw new AccountFinancialDataUnavailable();
  return eligible.reduce((totals, account) => addAccountToWealth(totals, account.isAsset, accountBaseAmount(account, currency, rates)),
    emptyWealthTotals(currency));
}

async function valueInputs(tx: SummaryTransaction, householdId: string, input: Inputs): Promise<AccountWealthSummary> {
  const totals = await valueWealth(tx, householdId, input);
  return { totalAssets: totals.assets.toNumber(), totalLiabilities: totals.liabilities.toNumber(), netWorth: netWorthOf(totals).toNumber(),
    currency: totals.assets.currency, scope: ACCOUNT_WEALTH_SCOPE, complete: false,
    valuationDate: input.asOf.toISOString().slice(0, 10), fxPolicy: "trusted_same_day_only" };
}

async function valueWealth(tx: SummaryTransaction, householdId: string, input: Inputs): Promise<WealthTotals> {
  if (input.positions.some(row => row.priceEvidence.overrides.length > 1)) {
    throw new ConflictError("Household security price periods overlap. Resolve the overlapping prices and try again.");
  }
  if (!isCurrencyCode(input.currency)) throw new AccountFinancialDataUnavailable();
  const bondValues = input.bonds.map(({ bond, evidence, couponState }) => {
    const account = input.accounts.find(row => row.id === bond.accountId);
    const value = verifiedBondMarketValue(bond, evidence, couponState, input.asOf.toISOString().slice(0, 10));
    if (!value || account?.currency !== "ZMW" || account.isAsset !== true) throw new AccountFinancialDataUnavailable();
    return value.dirty;
  });
  const eligible = input.accounts.filter(isEligibleForWealth);
  const rates = accountValuationRates(input.quotes, input.currency, input.asOf);
  const context = { database: tx, accountIds: input.accounts.map(account => account.id),
    valuationDate: input.asOf.toISOString().slice(0, 10),
    getLatestFxRates: async () => rates };
  if (eligible.some(account => !isCurrencyCode(account.currency)) || input.positions.some(row => !isCurrencyCode(row.security.currency) || row.security.currentPrice === null) ||
      input.pensions.some(row => row.currentBalance === null)) throw new AccountFinancialDataUnavailable();
  const requiredValues = [...input.positions.flatMap(row => [row.holding.quantity, row.security.currentPrice]),
    ...input.bills.map(row => tbillCarryingValue(row)), ...input.pensions.map(row => row.currentBalance)];
  try { if (requiredValues.some(value => value === null || !new Money(value).amount.isFinite())) throw new AccountFinancialDataUnavailable(); }
  catch { throw new AccountFinancialDataUnavailable(); }
  const accountTotals = accountWealth(eligible, input.currency, rates);
  let assets = accountTotals.assets;
  // Reuse the accepted valuation implementation and its existing eligibility and
  // arithmetic. Optional accountIds scopes only this ordinary reader.
  const investments = await portfolioValuationService.getHouseholdInvestmentValue(householdId, input.currency, context);
  const bills = await portfolioValuationService.getTBillsValue(householdId, input.currency, context);
  const pensions = await portfolioValuationService.getPensionValue(householdId, input.currency, context);
  assets = assets.add(investments.totalValue).add(bills).add(pensions);
  for (const value of bondValues) {
    if (input.currency === "ZMW") assets = assets.add(value);
    else {
      const rate = rates.get("ZMW");
      if (rate === undefined) throw new CalculationError("MISSING_FX_RATE", { from: "ZMW", to: input.currency });
      assets = assets.add(value.multiply(rate));
    }
  }
  return { assets, liabilities: accountTotals.liabilities };
}

type HistoryWindow = { from: string; to: string; scope: "user" | "household"; includeAccounts?: boolean; ownerUserId?: string | null };
function requireHistoryScope(actor: Awaited<ReturnType<typeof readAccountActor>>, history?: HistoryWindow) {
  if (history?.scope === "household" && actor.role !== "owner" && actor.role !== "admin") throw new ForbiddenError("Household history selection requires owner or admin");
}

const PUBLICATION_ATTEMPTS = 3;
const VALUES_CHANGED_WHILE_READ = "Account values changed while being read. Please try again.";

/** Current values and captured history share one audience and one publication proof. */
async function readWealthFrame(householdId: string, userId: string, capability: "financial.read" | "financial.export", history?: HistoryWindow, auditExport = false) {
  const asOf = new Date();
  for (let attempt = 0; attempt < PUBLICATION_ATTEMPTS; attempt++) {
    const captured = await db.transaction(async tx => {
      const actor = await readAccountActor(tx, householdId, userId, capability);
      requireHistoryScope(actor, history);
      const inputs = await readInputs(tx, actor, asOf);
      const capturedHistory = history ? await readCapturedAccountHistory(tx, householdId, history.from, history.to, inputs.accounts.map(account => account.id), history.scope) : undefined;
      let summary: AccountWealthSummary | undefined;
      let failure: CalculationError | AccountFinancialDataUnavailable | ConflictError | undefined;
      try { summary = await valueInputs(tx, householdId, inputs); }
      catch (error) {
        if (error instanceof CalculationError || error instanceof AccountFinancialDataUnavailable || error instanceof ConflictError) failure = error;
        else throw error;
      }
      return { inputs, summary, failure, capturedHistory };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    // Assembly and SQL awaits cannot preserve an earlier account/private-parent
    // grant. Rebuild on changed visible inputs, including parent reassignment.
    const current = await readAccountWealthPublication(householdId, userId, capability, asOf, financialProof(captured.inputs),
      history, captured.capturedHistory?.cut ?? [], auditExport && !captured.failure);
    if (!current.financialsMatch) continue;
    const currentHistory = captured.capturedHistory && history ? applyCurrentCaptureCut(captured.capturedHistory,
      current.cut, current.changed, captured.inputs.accounts.map(account => account.id), history.scope) : undefined;
    if (captured.failure && !history) throw captured.failure;
    return { summary: captured.summary ?? null, accounts: current.accounts,
      series: currentHistory?.series ?? [] };
  }
  throw new ConflictError(VALUES_CHANGED_WHILE_READ);
}

export async function readAccountSummary(householdId: string, userId: string, capability: "financial.read" | "financial.export" = "financial.read", auditExport = false) {
  const frame = await readWealthFrame(householdId, userId, capability, undefined, auditExport && capability === "financial.export");
  return { summary: frame.summary!, accounts: frame.accounts };
}

export async function readAccountSummaryHistory(householdId: string, userId: string, history: HistoryWindow) {
  const frame = await readWealthFrame(householdId, userId, "financial.read", history);
  const ownerUserId = canonicalAccountOwner(history.ownerUserId);
  return { series: frame.series, latest: frame.summary ? { assets: frame.summary.totalAssets, liabilities: frame.summary.totalLiabilities,
    netWorth: frame.summary.netWorth, currency: frame.summary.currency, valuationDate: frame.summary.valuationDate } : null,
    currentStatus: frame.summary ? "available" as const : "unavailable" as const, scope: history.scope,
    ...(history.includeAccounts ? { accessibleAccountCount: frame.accounts.length,
      accounts: frame.accounts.filter(account => ownerUserId === undefined || account.ownerUserId === ownerUserId).map(accountListProjection) } : {}),
    historyCoverage: "verified_snapshots_only" as const, unattestedHistory: "not_charted" as const };
}

export const NET_WORTH_VALUATION_CLASSES = ["holdings", "tbills", "pensions", "bonds"] as const;
export type NetWorthValuationClass = (typeof NET_WORTH_VALUATION_CLASSES)[number];
export interface NetWorthTotals extends WealthTotals {
  incomplete: boolean;
  omittedValuations: NetWorthValuationClass[];
}

function presentValuationClasses(input: Inputs): NetWorthValuationClass[] {
  const present: Record<NetWorthValuationClass, boolean> = { holdings: input.positions.length > 0, tbills: input.bills.length > 0,
    pensions: input.pensions.length > 0, bonds: input.bonds.length > 0 };
  return NET_WORTH_VALUATION_CLASSES.filter(kind => present[kind]);
}

/**
 * Net worth's own sources: accounts that count toward net worth, and only the
 * holdings, T-bills, pensions and bonds held in them. A source in a hidden,
 * archived or excluded account neither adds value nor marks net worth
 * incomplete. (The account summary keeps valuing every visible holding.)
 */
function netWorthSources(input: Inputs): Inputs {
  const accounts = input.accounts.filter(isEligibleForWealth);
  // Unattributed sources (no account) are never net-worth sources.
  const ids = new Set<string | null>(accounts.map(account => account.id));
  return { ...input, accounts, positions: input.positions.filter(row => ids.has(row.holding.accountId)),
    bills: input.bills.filter(row => ids.has(row.accountId)), pensions: input.pensions.filter(row => ids.has(row.accountId)),
    bonds: input.bonds.filter(row => ids.has(row.bond.accountId)) };
}

/** Every rate the full valuation converts with must exist; a missing one is the 422, never a partial total. */
function assertRequiredRates(sources: Inputs, currency: string, rates: ReadonlyMap<string, string>) {
  const required = new Set([...sources.accounts.map(account => account.currency), ...sources.positions.map(row => row.security.currency),
    ...(sources.bills.length || sources.pensions.length || sources.bonds.length ? ["ZMW"] : [])]);
  for (const from of required) {
    if (isCurrencyCode(from) && from !== currency && !rates.has(from)) throw new CalculationError("MISSING_FX_RATE", { from, to: currency });
  }
}

/** Why net worth came back incomplete, kept for the log after the publication recheck. */
type IncompleteCause = { code: string; errorName: string };
type NetWorthValuation = { totals: NetWorthTotals; cause?: IncompleteCause };

async function valueNetWorth(tx: SummaryTransaction, householdId: string, input: Inputs): Promise<NetWorthValuation> {
  const sources = netWorthSources(input);
  try {
    return { totals: { ...await valueWealth(tx, householdId, sources), incomplete: false, omittedValuations: [] } };
  } catch (error) {
    if (!(error instanceof AccountFinancialDataUnavailable || error instanceof ConflictError)) throw error;
    const omittedValuations = presentValuationClasses(sources);
    if (omittedValuations.length === 0 || !isCurrencyCode(sources.currency)) throw error;
    const rates = accountValuationRates(sources.quotes, sources.currency, sources.asOf);
    assertRequiredRates(sources, sources.currency, rates);
    return { totals: { ...accountWealth(sources.accounts, sources.currency, rates), incomplete: true, omittedValuations },
      cause: { code: error.code, errorName: error.name } };
  }
}

type NetWorthCapture = { input: Inputs } & (NetWorthValuation | { failure: CalculationError | AccountFinancialDataUnavailable | ConflictError });

/**
 * Current net worth for the reports fallback (FIN-14): the account summary's
 * audience, inputs and valuation (accounts, holdings, T-bills, pensions,
 * bonds) over net worth's own sources. When those classes cannot be valued,
 * the account balances are returned flagged incomplete with the omitted
 * classes, and the failure is logged. A missing FX rate is never absorbed: it
 * stays a 422. Every outcome (full, partial or failure) passes the account
 * summary's publication proof, so nothing the reader can no longer see is
 * published.
 */
export async function readNetWorthTotals(householdId: string, userId: string): Promise<NetWorthTotals> {
  const asOf = new Date();
  for (let attempt = 0; attempt < PUBLICATION_ATTEMPTS; attempt++) {
    const captured = await db.transaction(async (tx): Promise<NetWorthCapture> => {
      const actor = await readAccountActor(tx, householdId, userId, "financial.read");
      const input = await readInputs(tx, actor, asOf);
      try { return { input, ...await valueNetWorth(tx, householdId, input) }; }
      catch (error) {
        if (error instanceof CalculationError || error instanceof AccountFinancialDataUnavailable || error instanceof ConflictError) return { input, failure: error };
        throw error;
      }
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    const current = await readAccountWealthPublication(householdId, userId, "financial.read", asOf, financialProof(captured.input));
    if (!current.financialsMatch) continue;
    if ("failure" in captured) throw captured.failure;
    if (captured.cause) {
      logger.error("Net worth valuation unavailable; returning account balances flagged incomplete", {
        householdId, omittedValuations: captured.totals.omittedValuations, ...captured.cause });
    }
    return captured.totals;
  }
  throw new ConflictError(VALUES_CHANGED_WHILE_READ);
}
