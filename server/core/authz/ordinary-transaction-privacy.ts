import { ValidationError } from "../../utils/errorHandler";

type PrivacyInput = { isPrivate?: unknown; ownerUserId?: string | null };
type PreviousPrivacy = { isPrivate: boolean; ownerUserId: string | null; type: string };

export function assertTransactionPrivacyFlag(value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new ValidationError("Transaction privacy requires an explicit boolean", [{ field: "isPrivate", message: "Use true or false" }]);
  }
}

/** Run after the ordinary writer has locked its current grant, row and account.
 * Attribution stays independent: never turn Shared or a peer into the actor. */
export function assertOrdinaryPrivacyOwner(input: PrivacyInput, actorUserId?: string, before?: PreviousPrivacy): void {
  assertTransactionPrivacyFlag(input.isPrivate);
  if (before?.type === "transfer") {
    if (input.isPrivate !== undefined) throw new ValidationError("Transfer privacy requires its paired workflow");
    return;
  }
  const privateRecord = input.isPrivate === undefined ? before?.isPrivate === true : input.isPrivate;
  const owner = input.ownerUserId === undefined ? before?.ownerUserId : input.ownerUserId;
  if (privateRecord && actorUserId && (typeof owner !== "string" || owner.toLowerCase() !== actorUserId.toLowerCase())) {
    throw new ValidationError("Private transactions must belong to you. Publish the transaction explicitly before changing its owner.", [
      { field: "ownerUserId", message: "Choose yourself for a private transaction, or explicitly clear Private" },
    ]);
  }
}
