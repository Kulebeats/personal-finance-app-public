import { z } from "zod";

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  displayName: z.string().max(50).optional(),
  birthday: z.string().optional().nullable(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  bio: z.string().max(1000).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const updatePreferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  dateFormat: z.string().optional(),
  currency: z.string().length(3).optional(),
  weekStartDay: z.number().min(0).max(6).optional(),
  notificationsEnabled: z.boolean().optional(),
  showPendingTransactions: z.boolean().optional(),
  allowEditPending: z.boolean().optional(),
});

export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(
    z.object({
      notificationType: z.string(),
      inAppEnabled: z.boolean().optional(),
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      thresholdAmount: z.union([z.string(), z.number()]).optional().nullable(),
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
