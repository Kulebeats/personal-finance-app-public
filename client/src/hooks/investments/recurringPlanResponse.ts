import { z } from "zod";
import type { RecurringInvestment } from "./types";

const planSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  accountId: z.string().uuid(),
  securityId: z.string().uuid().nullable(),
  type: z.string(),
  frequency: z.string(),
  amount: z.string(),
  currency: z.string(),
  nextExecutionDate: z.string(),
  isActive: z.boolean(),
  authorizationStatus: z.enum(["authorization_recorded", "authorization_required", "inactive", "pending_reconciliation"]),
  authorizationRevision: z.number().int().nonnegative().safe(),
  authorizationInitialExecutionDate: z.string().nullable(),
  permittedActions: z.array(z.enum(["authorize", "deactivate"])),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  accountName: z.string().optional(),
  securityName: z.string().optional(),
});
const successEnvelope = z.object({ success: z.literal(true) });
const listEnvelope = successEnvelope.extend({ data: z.array(planSchema) });
const planEnvelope = successEnvelope.extend({ data: planSchema });

export type RecurringList = { success: true; data: RecurringInvestment[] };

export function readRecurringList(response: unknown, householdId: string | undefined): RecurringList {
  const result = listEnvelope.safeParse(response);
  if (!result.success || !householdId || result.data.data.some(plan => plan.householdId !== householdId)) {
    throw new Error("The recurring plan list could not be verified.");
  }
  return result.data;
}

export function readRecurringAcknowledgement(
  response: unknown,
  householdId: string | undefined,
  kind: "create" | "authorize" | "deactivate",
  planId?: string,
): RecurringInvestment | null {
  if (kind === "deactivate" && successEnvelope.safeParse(response).success) return null;
  if (kind !== "deactivate") {
    const result = planEnvelope.safeParse(response);
    if (result.success && result.data.data.householdId === householdId &&
        (kind !== "authorize" || result.data.data.id === planId)) return result.data.data;
  }
  throw new Error("The recurring plan acknowledgement could not be verified.");
}
