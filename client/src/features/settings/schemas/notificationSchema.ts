import { z } from 'zod';

export const notificationPreferenceSchema = z.object({
  notificationType: z.string(),
  inAppEnabled: z.boolean().default(true),
  emailEnabled: z.boolean().default(false),
  pushEnabled: z.boolean().default(false),
  thresholdAmount: z.string().nullable().optional(),
});

export const notificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
});

export type NotificationPreferenceData = z.infer<typeof notificationPreferenceSchema>;
export type NotificationPreferencesData = z.infer<typeof notificationPreferencesSchema>;
