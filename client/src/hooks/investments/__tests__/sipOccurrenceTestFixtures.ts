// Synthetic public-wire fixtures. These contain no real broker or household data.
export const ids = {
  subject: "11111111-1111-4111-8111-111111111111",
  household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333",
  security: "44444444-4444-4444-8444-444444444444",
  plan: "55555555-5555-4555-8555-555555555555",
  operation: "66666666-6666-4666-8666-666666666666",
  otherSubject: "77777777-7777-4777-8777-777777777777",
  otherHousehold: "88888888-8888-4888-8888-888888888888",
  otherPlan: "99999999-9999-4999-8999-999999999999",
};
export const scheduledDate = "2030-01-20";
export const privateReference = "SYNTHETIC-PRIVATE-REFERENCE-UNCHANGED";
export const planned = {
  accountId: ids.account,
  securityId: ids.security,
  amount: "10.00",
  currency: "USD",
  authorizedFrequency: "monthly" as const,
  authorizedInitialDate: "2029-12-20",
};
export const actualFills = [
  { executionDate: "2030-01-19", quantity: "1.25000000", price: "2.4000", fees: "0.10" },
  { executionDate: "2030-01-21", quantity: "0.50000000", price: "4.2000", fees: "0.02" },
];
export type FillDraft = typeof actualFills[number];
export type ConfirmationDraft = {
  finalStatement: true;
  outcome: "filled" | "partially_filled" | "unfilled";
  brokerReference?: string;
  fills: FillDraft[];
};
export type ConfirmationBody = ConfirmationDraft & {
  operationId: string;
  expectedRevision: number;
};
export function confirmationDraft(): ConfirmationDraft {
  return {
    finalStatement: true,
    outcome: "partially_filled",
    brokerReference: privateReference,
    fills: actualFills.map(fill => ({ ...fill })),
  };
}
export function confirmationBody(): ConfirmationBody {
  return { operationId: ids.operation, expectedRevision: 0, ...confirmationDraft() };
}
export function pendingOccurrence() {
  return {
    planId: ids.plan,
    scheduledDate,
    state: "pending" as const,
    detailsAvailable: true as const,
    occurrenceRevision: 0 as const,
    planned: { ...planned },
    permittedActions: ["confirm" as const],
  };
}
export function closedOccurrence() {
  return {
    planId: ids.plan,
    scheduledDate,
    state: "closed" as const,
    detailsAvailable: true as const,
    occurrenceRevision: 1 as const,
    planned: { ...planned },
    result: {
      outcome: "partially_filled" as ConfirmationDraft["outcome"],
      fills: actualFills.map((fill, fillIndex) => ({
        ...fill,
        fillIndex,
        purchaseId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(fillIndex + 1).padStart(12, "0")}`,
        amount: fillIndex === 0 ? "3.10" : "2.12",
      })),
      totals: { grossAmount: "5.10", fees: "0.12", amount: "5.22" },
    },
  };
}
export function closedFence() {
  return { planId: ids.plan, scheduledDate, state: "closed" as const, detailsAvailable: false as const };
}
export function listEnvelope(data: unknown[] = [pendingOccurrence()]) {
  return { success: true as const, data, pagination: { hasMore: false, nextBefore: null as string | null } };
}
export function acknowledgment(operationId = ids.operation, occurrence = closedOccurrence()) {
  return { success: true as const, data: { requestVersion: 1 as const, operationId, occurrence } };
}
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
export function cacheText(value: unknown): string {
  const visited = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object") {
      if (visited.has(item)) return "[cycle]";
      visited.add(item);
      if (item instanceof Error) {
        const own = Object.fromEntries(Object.getOwnPropertyNames(item).map(key =>
          [key, Object.getOwnPropertyDescriptor(item, key)?.value]));
        return { ...own, name: item.name, message: item.message, stack: item.stack,
          cause: (item as Error & { cause?: unknown }).cause };
      }
    }
    return item;
  }) ?? "";
}
