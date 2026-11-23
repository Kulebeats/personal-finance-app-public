import { securities } from "@shared/schema";
import { ConflictError, ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import type { TransactionType } from "../../utils/withTransaction";
import { createSecuritySchema } from "./investments.validation";

export type SecurityRecord = typeof securities.$inferSelect;

export interface SecurityCreateAudit {
  userId: string;
  /** Null for an operator adding to the curated list: no household's data changed. */
  householdId: string | null;
  ipAddress: string | undefined;
}

/**
 * NEW-13: the one insert path for a catalogue row. `ownerHouseholdId` null is
 * the operator-curated list every household picks from; a household id makes a
 * custom security only that household can see, price or hold. The row and its
 * audit entry commit together (Rule 9).
 */
export async function insertCatalogueSecurity(
  tx: TransactionType,
  input: unknown,
  ownerHouseholdId: string | null,
  audit: SecurityCreateAudit,
): Promise<SecurityRecord> {
  const parsed = createSecuritySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid request data", parsed.error.errors);
  }
  const metadata = parsed.data;
  const [security] = await tx
    .insert(securities)
    .values({
      ownerHouseholdId,
      symbol: metadata.symbol,
      name: metadata.name,
      type: metadata.type,
      currency: metadata.currency,
      exchange: metadata.exchange ?? null,
      isOffshore: metadata.isOffshore ?? false,
      sector: metadata.sector ?? null,
      cusipIsin: metadata.cusipIsin ?? null,
      currentPrice: null,
      withholdingTaxRate: metadata.withholdingTaxRate ?? null,
      lastPriceUpdate: null,
    })
    // Only uniq_securities_custom_symbol can conflict: one custom symbol per household.
    .onConflictDoNothing()
    .returning();
  if (!security) {
    throw new ConflictError("Your household already has a security with this symbol");
  }

  await businessAuditService.logCreate({
    tx,
    userId: audit.userId,
    householdId: audit.householdId,
    entityType: "security",
    entityId: security.id,
    newValue: {
      symbol: security.symbol,
      name: security.name,
      type: security.type,
      currency: security.currency,
      scope: ownerHouseholdId ? "household" : "curated",
    },
    ipAddress: audit.ipAddress,
  });
  return security;
}
