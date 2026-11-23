import { describe, expect, it } from "vitest";
import {
  toUserPreferencesResponse,
  userPreferencesDefaults,
  userPreferencesEnvelopeSchema,
  userPreferencesPatchSchema,
} from "@shared/user-preferences";

const userId = "ad14a509-184d-4577-a9d5-381d23702624";

describe("personal preferences contract", () => {
  it("normalizes an absent row without inventing timestamps", () => {
    const response = toUserPreferencesResponse(userId, undefined);
    expect(response).toEqual({ userId, ...userPreferencesDefaults, createdAt: null, updatedAt: null });
    expect(userPreferencesEnvelopeSchema.parse({ success: true, data: { preferences: response } }))
      .toEqual({ success: true, data: { preferences: response } });
  });

  it("uses defaults only for legacy nulls, preserving explicit false and zero", () => {
    const time = new Date("2026-10-30T10:00:00.000Z");
    expect(toUserPreferencesResponse(userId, {
      rememberLastAccount: false,
      autoCreateFromReceipt: null,
      ocrConfidenceThreshold: 0,
      defaultTransactionType: null,
      createdAt: time,
    })).toMatchObject({
      rememberLastAccount: false,
      autoCreateFromReceipt: false,
      ocrConfidenceThreshold: 0,
      defaultTransactionType: "expense",
      createdAt: time.toISOString(),
      updatedAt: null,
    });
  });

  it("rejects explicit invalid stored enums and percentages", () => {
    expect(() => toUserPreferencesResponse(userId, { defaultTransactionType: "unsupported" })).toThrow();
    expect(() => toUserPreferencesResponse(userId, { defaultAccountFilter: "someone-else" })).toThrow();
    expect(() => toUserPreferencesResponse(userId, { ocrConfidenceThreshold: 101 })).toThrow();
  });

  it("accepts every percentage from zero through one hundred as integer boundaries", () => {
    expect(userPreferencesPatchSchema.parse({ ocrConfidenceThreshold: 0 })).toEqual({ ocrConfidenceThreshold: 0 });
    expect(userPreferencesPatchSchema.parse({ ocrConfidenceThreshold: 100 })).toEqual({ ocrConfidenceThreshold: 100 });
    expect(userPreferencesPatchSchema.safeParse({ ocrConfidenceThreshold: -1 }).success).toBe(false);
    expect(userPreferencesPatchSchema.safeParse({ ocrConfidenceThreshold: 101 }).success).toBe(false);
    expect(userPreferencesPatchSchema.safeParse({ ocrConfidenceThreshold: 20.5 }).success).toBe(false);
  });

  it.each([{}, null, { userId }, { ownerUserId: userId }, { householdId: userId },
    { rememberLastAccount: false, unknown: 1 }, { rememberLastAccount: null },
    { defaultTransactionType: "refund" }, { defaultAccountFilter: userId }])
  ("rejects empty, foreign, unknown or malformed patches", patch => {
    expect(userPreferencesPatchSchema.safeParse(patch).success).toBe(false);
  });
});
