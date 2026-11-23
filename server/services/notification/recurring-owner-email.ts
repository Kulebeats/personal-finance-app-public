/**
 * REC (owner decision a1): one bill reminder e-mail per notice, to the rule's
 * e-mail owner as they are when it is sent.
 *
 * The per-recipient notices carry in-app and push only; each leaves a
 * suppressed e-mail row (`email_owner_only`). The e-mail is decided after them,
 * so an account that changes hands while the notices go out still e-mails its
 * new owner, whatever order the members were processed in.
 *
 * Who the owner is, whether they may see the rule and what it says are one
 * locked decision (`withRecurringEmailDecision`). It is taken once to pick the
 * ledger row and again inside the send, which goes out while that decision
 * holds: a transfer, privacy or role change waits for the send, and one that
 * landed before it hands the e-mail to the new owner (`not_email_owner`).
 *
 * Each owner has their own ledger row. `email_owner_only`, `not_email_owner`
 * and `not_visible` are not final for that member, so a later run takes them
 * again: an owner change between runs e-mails the new owner, and an account
 * (or a view of the rule) that comes back to a former owner e-mails them. A notice whose in-app
 * row predates the ledger was e-mailed by the old sender and is not sent again.
 *
 * @module services/notification/recurring-owner-email
 */
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { notificationRepository } from "../../repositories/NotificationRepository";
import { deliverOnce, hasDeliveryRecord, PRE_DISPATCH_FAILURE, SCHEDULED_DISPATCH_READY, type ChannelResult } from "./delivery";
import { sendNotificationEmail } from "./email-channel";
import {
  CONTENT_CHANGED, NOT_EMAIL_OWNER, NOT_VISIBLE, RECONSIDERED_EMAIL_REASONS, recurringEmailDecision,
  recurringNoticeDedupeKey, sameContent, withRecurringEmailDecision, type RecurringEmailDecision, type RecurringNoticeRef,
} from "./recurring-notice";

/** Ownership changes followed within one run before leaving the e-mail to the next run. */
const MAX_OWNER_HANDOFFS = 3;
const QUIET_HOURS: ChannelResult = { status: "suppressed", reason: "quiet_hours" };

export interface OwnerEmailGates {
  emailEnabled(userId: string): Promise<boolean>;
  inQuietHours(userId: string): Promise<boolean>;
  assertWindow?: () => void;
}

/** The old sender wrote the in-app row and e-mailed without a ledger row. */
async function deliveredBeforeLedger(owner: string, eventKey: string): Promise<boolean> {
  return await notificationRepository.existsByDedupeKey(owner, eventKey) && !(await hasDeliveryRecord(owner, eventKey));
}

/** Sends the notice's e-mail to its current owner. Returns who it was sent to, or null. */
export async function dispatchRecurringOwnerEmail(
  ref: RecurringNoticeRef, gates: OwnerEmailGates,
): Promise<string | null> {
  for (let handoff = 0; handoff < MAX_OWNER_HANDOFFS; handoff++) {
    gates.assertWindow?.();
    const chosen = await recurringEmailDecision(ref);
    if (!chosen || !(await gates.emailEnabled(chosen.owner))) return null;
    const eventKey = recurringNoticeDedupeKey(ref, chosen.owner);
    if (await deliveredBeforeLedger(chosen.owner, eventKey)) return null;
    let handedOff = false;
    const outcome = await deliverOnce(chosen.owner, eventKey, "email", async () => {
      let dispatchStarted = false;
      try {
        // A former owner's quiet hours never hold back the new owner.
        const isQuiet = await gates.inQuietHours(chosen.owner);
        return await withRecurringEmailDecision(ref, async (now) => {
          if (!now) return NOT_VISIBLE;
          handedOff = now.owner !== chosen.owner;
          const hold = ownerEmailHold(chosen, now, isQuiet);
          if (hold) return hold;
          const { message } = now;
          return sendNotificationEmail(now.owner, NOTIFICATION_TYPES.RECURRING_DUE, message.title, message.body, message.actionUrl,
            undefined, { retryBeforeDispatch: true, onDispatch: () => {
              gates.assertWindow?.();
              dispatchStarted = true;
            } });
        });
      } catch (error) {
        if (dispatchStarted) throw error;
        return PRE_DISPATCH_FAILURE;
      }
    }, { retrySuppressed: [SCHEDULED_DISPATCH_READY, ...RECONSIDERED_EMAIL_REASONS] });
    if (outcome.status === "failed") throw new Error("Recurring owner email requires a retry");
    if (outcome.attempted && outcome.status === "sent") return chosen.owner;
    if (!handedOff) return null;
  }
  return null;
}

/** Inside the held decision, verify the recipient and content before dispatch. */
function ownerEmailHold(
  chosen: RecurringEmailDecision, now: RecurringEmailDecision, isQuiet: boolean,
): ChannelResult | null {
  if (now.owner !== chosen.owner) return NOT_EMAIL_OWNER;
  if (isQuiet) return QUIET_HOURS;
  if (!sameContent(now.content, chosen.content)) return CONTENT_CHANGED;
  return null;
}
