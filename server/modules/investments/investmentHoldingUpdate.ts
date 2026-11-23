import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { holdings, securities, type Holding } from "@shared/schema";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { withTransaction } from "../../utils/withTransaction";
import { lockInvestmentTransactionSources, lockInvestmentWriterIdentity, type InvestmentSourceSession } from "./investmentTransactionAccess";
import { updateHoldingSchema, type UpdateHoldingInput } from "./investments.validation";
import { lockHoldingBasisDisclosure } from "./investmentHoldingBasisSource";
import { z } from "zod";

const Exact = Decimal.clone({ precision: 48 });
function noChange(holding: Holding, data: UpdateHoldingInput) {
  return Object.entries(data).every(([key, value]) => {
    if (value === undefined) return true;
    const original = holding[key as keyof UpdateHoldingInput];
    if (value === null || original === null) return value === original;
    return key === "acquiredDate" ? value === original : new Exact(value).eq(original!);
  });
}
/** This is an admission guard, not the explicit acquisition correction flow.
 * A proven position cannot accept a declaration that a later trade discards. */
export async function updateDeclaredHolding(id: string, input: UpdateHoldingInput, caller: HouseholdContext,
  _ipAddress: string | undefined, session: InvestmentSourceSession) {
  if (session?.snapshot?.id !== caller?.userId || !session?.sessionId) throw new UnauthorizedError("Authentication changed; sign in again");
  const parsed = updateHoldingSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid request data", parsed.error.errors);
  const data = parsed.data;
  return withTransaction(async tx => {
    // Check authority even for missing rows or an exact no-op. The unlocked
    // identity hint below conveys no source read permission to the caller.
    await lockInvestmentWriterIdentity(tx, caller, session);
    let holding: Holding;
    try {
      if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Holding");
      const [hint] = await tx.select({ accountId: holdings.accountId, securityId: holdings.securityId }).from(holdings)
        .where(and(eq(holdings.id, id), eq(holdings.householdId, caller.householdId)));
      if (!hint) throw new NotFoundError("Holding");
      const source = await lockInvestmentTransactionSources(tx, caller, { ...hint, holdingId: id }, session);
      if (!source.holding) throw new NotFoundError("Holding");
      holding = source.holding;
      const [security] = await tx.select({ currency: securities.currency }).from(securities).where(eq(securities.id, holding.securityId));
      if (!security) throw new NotFoundError("Holding");
      // This precedes BOTH no-op comparison and read-back. A guess cannot
      // distinguish private prior cost by observing 200 versus 409.
      await lockHoldingBasisDisclosure(tx, holding, security.currency, source.actor);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ConflictError) throw new NotFoundError("Holding");
      throw error;
    }
    if (noChange(holding, data)) return holding;
    // Shells also need the explicit opening initialization/correction flow.
    // A generic aggregate edit must not acknowledge unsourced positive shares.
    throw new ConflictError("Review the holding's acquisition history before changing financial fields");
  });
}
