import { z } from "zod";

export const userPreferencesDefaults = {
  rememberLastAccount: true,
  rememberLastCategoryPerMerchant: true,
  defaultTransactionType: "expense",
  autoFillTodayDate: true,
  skipDuplicateImports: true,
  autoAssignCategoriesFromRules: true,
  autoCreateFromReceipt: false,
  requireOcrReview: true,
  ocrConfidenceThreshold: 70,
  defaultAccountFilter: "all",
} as const;

const userPreferencesValuesSchema = z.object({
  rememberLastAccount: z.boolean(),
  rememberLastCategoryPerMerchant: z.boolean(),
  defaultTransactionType: z.enum(["expense", "income", "transfer"]),
  autoFillTodayDate: z.boolean(),
  skipDuplicateImports: z.boolean(),
  autoAssignCategoriesFromRules: z.boolean(),
  autoCreateFromReceipt: z.boolean(),
  requireOcrReview: z.boolean(),
  ocrConfidenceThreshold: z.number().int().min(0).max(100),
  defaultAccountFilter: z.enum(["all", "mine", "shared"]),
}).strict();

export const userPreferencesPatchSchema = userPreferencesValuesSchema.partial()
  .refine(value => Object.keys(value).length > 0, {
    message: "At least one personal preference field is required",
  });

export const userPreferencesResponseSchema = userPreferencesValuesSchema.extend({
  userId: z.string().uuid(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

export const userPreferencesEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ preferences: userPreferencesResponseSchema }),
});

export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;
export type UserPreferencesResponse = z.infer<typeof userPreferencesResponseSchema>;

export type StoredUserPreferences = {
  rememberLastAccount?: boolean | null;
  rememberLastCategoryPerMerchant?: boolean | null;
  defaultTransactionType?: string | null;
  autoFillTodayDate?: boolean | null;
  skipDuplicateImports?: boolean | null;
  autoAssignCategoriesFromRules?: boolean | null;
  autoCreateFromReceipt?: boolean | null;
  requireOcrReview?: boolean | null;
  ocrConfidenceThreshold?: number | null;
  defaultAccountFilter?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

/** Legacy SQL NULLs use the declared field defaults; explicit invalid values fail validation. */
export function toUserPreferencesResponse(
  userId: string,
  row: StoredUserPreferences | null | undefined,
): UserPreferencesResponse {
  return userPreferencesResponseSchema.parse({
    userId,
    rememberLastAccount: row?.rememberLastAccount ?? userPreferencesDefaults.rememberLastAccount,
    rememberLastCategoryPerMerchant: row?.rememberLastCategoryPerMerchant ?? userPreferencesDefaults.rememberLastCategoryPerMerchant,
    defaultTransactionType: row?.defaultTransactionType ?? userPreferencesDefaults.defaultTransactionType,
    autoFillTodayDate: row?.autoFillTodayDate ?? userPreferencesDefaults.autoFillTodayDate,
    skipDuplicateImports: row?.skipDuplicateImports ?? userPreferencesDefaults.skipDuplicateImports,
    autoAssignCategoriesFromRules: row?.autoAssignCategoriesFromRules ?? userPreferencesDefaults.autoAssignCategoriesFromRules,
    autoCreateFromReceipt: row?.autoCreateFromReceipt ?? userPreferencesDefaults.autoCreateFromReceipt,
    requireOcrReview: row?.requireOcrReview ?? userPreferencesDefaults.requireOcrReview,
    ocrConfidenceThreshold: row?.ocrConfidenceThreshold ?? userPreferencesDefaults.ocrConfidenceThreshold,
    defaultAccountFilter: row?.defaultAccountFilter ?? userPreferencesDefaults.defaultAccountFilter,
    createdAt: row?.createdAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}
