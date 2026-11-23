import { userPreferencesDefaults, type UserPreferencesResponse } from "@shared/user-preferences";
export const personalUserId = "11111111-1111-4111-8111-111111111111";
export const personalPreferences = (changes: Partial<UserPreferencesResponse> = {}): UserPreferencesResponse => ({
  ...userPreferencesDefaults, userId: personalUserId, createdAt: null, updatedAt: null, ...changes,
});
export const personalEnvelope = (changes: Partial<UserPreferencesResponse> = {}) => ({ success: true, data: { preferences: personalPreferences(changes) } });
