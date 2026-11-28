import { z } from "zod";
import { INVESTMENT_NOTIFICATION_PREFERENCE_TYPES, NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { passwordPolicySchema } from "../auth/auth.password-policy";

export { updateProfileSchema, type UpdateProfileInput } from "./settings.profile.validation";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// Household policy only; display settings have their own validation schema.
export const updatePreferencesSchema = z.object({
  showPendingTransactions: z.boolean().optional(),
  allowEditPending: z.boolean().optional(),
  // NEW-16: the budget rollover projection reads this column.
  autoRolloverBudget: z.boolean().optional(),
}).strict().refine(
  (data) => data.showPendingTransactions !== undefined
    || data.allowEditPending !== undefined
    || data.autoRolloverBudget !== undefined,
  { message: "At least one household policy field is required" },
);

/**
 * NEW-26: a threshold is a non-negative amount that fits decimal(15,2): at most
 * 13 integer digits and 2 decimals. A JSON number is checked by its own
 * spelling, so a float such as 0.30000000000000004 or 1e21 is refused rather
 * than rounded. Zero stays valid.
 */
const NOTIFICATION_THRESHOLD_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;
export const notificationThresholdSchema = z.union([z.string(), z.number()])
  .transform(value => String(value))
  .refine(value => NOTIFICATION_THRESHOLD_PATTERN.test(value), {
    message: "Threshold must be a non-negative amount with at most 2 decimal places",
  });

export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(
    z.object({
      notificationType: z.union([z.nativeEnum(NOTIFICATION_TYPES), z.enum(INVESTMENT_NOTIFICATION_PREFERENCE_TYPES)]),
      inAppEnabled: z.boolean().optional(),
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      thresholdAmount: notificationThresholdSchema.optional().nullable(),
    }),
  ),
});

export const updateDisplaySettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(100).optional(),
  numberFormat: z.enum(["US", "EU", "IN"]).optional(),
  dateFormat: z.string().max(20).optional(),
  currencyPosition: z.enum(["before", "after"]).optional(),
  firstDayOfWeek: z
    .enum([
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ])
    .optional(),
  viewMode: z.enum(["compact", "comfortable"]).optional(),
  dashboardWidgets: z
    .object({
      widgets: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          enabled: z.boolean(),
        })
      ),
      version: z.number(),
    })
    .optional(),
});
