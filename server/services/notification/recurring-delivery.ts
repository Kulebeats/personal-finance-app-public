import { logger } from "../../utils/logger";
import { recurringRuleAudience } from "./audience";
import { hasRetryableChannelFailure } from "./delivery";
import { dispatchRecurringOwnerEmail, type OwnerEmailGates } from "./recurring-owner-email";
import { recurringNoticeDedupeKey, type RecurringNoticeRef } from "./recurring-notice";
import type { NotifyData, NotifyOutcome } from "./service";

/** Visit every current recipient, then try the owner's independently gated email. */
export async function deliverRecurringDue(
  ref: RecurringNoticeRef,
  notify: (userId: string, data: NotifyData) => Promise<NotifyOutcome>,
  gates: OwnerEmailGates,
): Promise<number> {
  const recipients = await recurringRuleAudience(ref.householdId, ref.recurringId);
  const delivered = new Set<string>();
  let failed = false;

  for (const userId of recipients) {
    try {
      const outcome = await notify(userId, {
        title: "", body: "", dedupeKey: recurringNoticeDedupeKey(ref, userId),
        recurringNotice: ref, emailSuppressed: true, scheduledRecovery: true, assertScheduledWindow: gates.assertWindow,
      });
      if (outcome.delivered) delivered.add(userId);
      if (hasRetryableChannelFailure(outcome.channels)) failed = true;
    } catch (error) {
      failed = true;
      logger.warn("Could not publish recurring reminder for recipient", { userId, recurringId: ref.recurringId, error });
    }
  }

  const emailed = await dispatchRecurringOwnerEmail(ref, gates);
  if (emailed) delivered.add(emailed);
  if (failed) throw new Error("Recurring reminder requires a retry");
  return delivered.size;
}
