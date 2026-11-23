import { ConflictError, HttpError, InternalError } from "../../core/errors";
import { SipOccurrenceContractError } from "@shared/sip-occurrence-contract";
import { ValidationError } from "../../core/errors";
import { missingFxRateBody } from "../../core/errors/missingFxRate";

export type SipOccurrenceConflictReason = "OPERATION_INTENT_MISMATCH" | "OCCURRENCE_REVISION_CHANGED"
  | "OCCURRENCE_ALREADY_CLOSED" | "SOURCE_CHANGED" | "FIFO_HISTORY_CONFLICT" | "FILL_BEFORE_DECLARED_OPENING";

const messages: Record<SipOccurrenceConflictReason, string> = {
  OPERATION_INTENT_MISMATCH: "The operation does not match its original confirmation.",
  OCCURRENCE_REVISION_CHANGED: "The occurrence changed; refresh before confirming.",
  OCCURRENCE_ALREADY_CLOSED: "This occurrence is already closed.",
  SOURCE_CHANGED: "The investment source changed; review it before confirming.",
  FIFO_HISTORY_CONFLICT: "Review the holding's recorded history before confirming.",
  FILL_BEFORE_DECLARED_OPENING: "A fill cannot be dated before the holding's declared opening date.",
};

export class SipOccurrenceConflict extends ConflictError {
  constructor(readonly reason: SipOccurrenceConflictReason) {
    super(messages[reason]);
  }

  override toJSON() {
    const result = super.toJSON();
    return { ...result, error: { ...result.error, details: { reason: this.reason } } };
  }
}

export class SipOccurrenceUnavailable extends HttpError {
  readonly statusCode = 409;

  constructor(readonly code: "HOUSEHOLD_CALENDAR_REQUIRED" | "OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE") {
    super(code === "HOUSEHOLD_CALENDAR_REQUIRED"
      ? "Confirmation is unavailable until the household calendar is configured."
      : "This occurrence is closed and its confirmation details are unavailable.");
  }
}

/** Never propagate SQL parameters or a supplied reference into an error log. */
export function safeSipOccurrenceError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  // A foreign fill needs the dated rate for its execution date: a named 422, not an opaque retry.
  if (missingFxRateBody(error) && error instanceof Error) return error;
  if (error instanceof SipOccurrenceContractError) {
    return new ValidationError(error.message, error.fields.map(field => ({ field: field.path, message: field.message })));
  }
  return new InternalError("Occurrence confirmation is unavailable; retry with the original operation.");
}
