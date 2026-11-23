/**
 * Weekly Recap Module - Feedback (NEW-31, R16.3)
 *
 * Feedback is a queryable row, not a log line. The identity is the user, the
 * household, the recap week and the step, so a replay returns the same row
 * and a changed answer replaces the earlier one.
 *
 * @module modules/weekly-recap/feedback
 */

import { z } from "zod";
import {
  RECAP_FEEDBACK_CHOICES,
  RECAP_FEEDBACK_COMMENT_LIMIT,
  RECAP_FEEDBACK_STEPS,
  weeklyRecapFeedback,
} from "@shared/schema";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import { parseRecapWeek } from "./recap-week";

// CONTRACT-006: the client sends "wrap-up"; "overall" is the legacy value.
export const feedbackSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  step: z.enum(RECAP_FEEDBACK_STEPS),
  feedback: z.enum(RECAP_FEEDBACK_CHOICES),
  comment: z.string().trim().max(RECAP_FEEDBACK_COMMENT_LIMIT).optional()
    .transform(value => (value ? value : null)),
}).superRefine((value, context) => {
  if (!parseRecapWeek(value.weekStart, value.weekEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["weekEnd"],
      message: "A recap week is seven consecutive dates (YYYY-MM-DD)" });
  }
});

export type RecapFeedbackInput = z.infer<typeof feedbackSchema>;

export async function recordRecapFeedback(
  householdId: string,
  userId: string,
  input: RecapFeedbackInput,
  ipAddress: string | undefined,
): Promise<{ id: string }> {
  return withTransaction(async tx => {
    const [row] = await tx.insert(weeklyRecapFeedback).values({
      householdId, userId, weekStart: input.weekStart, weekEnd: input.weekEnd,
      step: input.step, choice: input.feedback, comment: input.comment,
    }).onConflictDoUpdate({
      target: [weeklyRecapFeedback.userId, weeklyRecapFeedback.householdId, weeklyRecapFeedback.weekStart, weeklyRecapFeedback.step],
      set: { weekEnd: input.weekEnd, choice: input.feedback, comment: input.comment, updatedAt: new Date() },
    }).returning({ id: weeklyRecapFeedback.id });
    // The comment is the user's own words; the audit row records only that
    // an answer was given.
    await businessAuditService.log({
      tx, householdId, userId, action: "CREATE", entityType: "user", entityId: userId,
      details: {
        action: "weekly_recap_feedback", feedbackId: row.id, step: input.step, feedback: input.feedback,
        weekStart: input.weekStart, weekEnd: input.weekEnd, hasComment: input.comment !== null,
      },
      ipAddress,
    });
    return row;
  });
}
