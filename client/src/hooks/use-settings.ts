import { toastActionError } from "@/lib/actionErrorToast";
import { protectedFetch } from "@/lib/protected-fetch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { userPreferencesEnvelopeSchema, userPreferencesPatchSchema, type UserPreferencesResponse, type UserPreferencesPatch } from "@shared/user-preferences";
import { toast } from "sonner";
import { announceRuleSave, type RuleApplyOutcome } from "@/lib/ruleApplyOutcome";
import type { DashboardWidgetsPreferences } from "@shared/schema";
import type { HouseholdMemberDto as HouseholdMember, HouseholdRole } from "@shared/household-members";
// apiCall attaches x-csrf-token to every mutating request (and self-heals on a
// stale token), so all mutations below MUST go through it — raw fetch 403s in
// any real browser session (server/app.ts CSRF middleware).
import { apiCall, securityApi } from "@/lib/api";
import { throwIfResNotOk } from "@/lib/queryClient";
import { invalidateSession } from "@/lib/session";
import { assertOperationLifetime, captureOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import Decimal from "decimal.js";
import type { MoneyDto } from "@shared/money";

// V7 response envelope (server/core/http success()).
interface Envelope<T> {
  success: boolean;
  data: T;
}

// Types
export interface UserProfile {
  id: string;
  username: string;
  email: string;
  // Personal Information
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  birthday: string | null;
  birthdayHideYear: boolean;
  gender: string | null;
  phoneNumber: string | null; // Legacy
  phoneNumberMobile: string | null;
  phoneNumberWork: string | null;
  phoneNumberHome: string | null;
  address: Record<string, unknown> | null; // JSON object
  occupation: string | null;
  occupationCustom: boolean;
  company: string | null;
  // Display
  timezone: string | null;
  profilePictureUrl: string | null;
  bannerUrl: string | null;
  // Rich profile fields
  bio: string | null;
  socialLinks: Record<string, string> | null;
  nrc: string | null;
  // Financial Profile
  annualIncome: string | null;
  incomeFrequency: string | null;
  employmentStatus: string | null;
  investmentGoal: string | null;
  riskTolerance: string | null;
  // Metadata
  profileCompleteness: number;
  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface Address {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country: string;
}

/**
 * Exactly the keys PUT /api/settings/profile accepts
 * (server/modules/settings/settings.profile.validation.ts). The server refuses
 * any other key with a 400. Picture and banner are not saved through this
 * endpoint; NRC is accepted only while NRC_FIELD_MODE is "editable".
 */
export interface UpdateProfileData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  birthday?: string | null;
  birthdayHideYear?: boolean;
  timezone?: string;
  bio?: string;
  gender?: string;
  phoneNumberMobile?: string | null;
  phoneNumberWork?: string | null;
  phoneNumberHome?: string | null;
  occupation?: string;
  address?: Address;
  annualIncome?: string | null;
  incomeFrequency?: string;
  employmentStatus?: string;
  investmentGoal?: string;
  riskTolerance?: string;
  /** "" clears the stored NRC. */
  nrc?: string;
  socialLinks?: Record<string, string | undefined>;
}

export interface DisplaySettings {
  userId: string;
  theme: string;
  currency: string;
  locale: string;
  timezone: string;
  numberFormat: string;
  dateFormat: string;
  currencyPosition: string;
  firstDayOfWeek: string;
  viewMode: string;
  dashboardWidgets: {
    widgets: DashboardWidgetsPreferences["widgets"];
    version: DashboardWidgetsPreferences["version"];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDisplaySettingsData {
  theme?: string;
  currency?: string;
  locale?: string;
  timezone?: string;
  numberFormat?: string;
  dateFormat?: string;
  currencyPosition?: string;
  firstDayOfWeek?: string;
  viewMode?: string;
  dashboardWidgets?: DashboardWidgetsPreferences;
}

// API functions
async function fetchProfile(): Promise<UserProfile> {
  const response = await protectedFetch("/api/settings/profile", {
    credentials: "include",
  });

  await throwIfResNotOk(response);

  const data = await response.json();
  return data.data.profile;
}

async function updateProfile(data: UpdateProfileData): Promise<UserProfile> {
  const result = await apiCall<Envelope<{ profile: UserProfile }>>(
    "/settings/profile",
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.profile;
}

async function uploadProfilePicture(
  file: File,
): Promise<{ profile: UserProfile; pictureUrl: string }> {
  const formData = new FormData();
  formData.append("picture", file);

  const result = await apiCall<
    Envelope<{ profile: UserProfile; pictureUrl: string }>
  >("/settings/profile/picture", { method: "POST", body: formData });
  return result.data;
}

async function deleteProfilePicture(): Promise<UserProfile> {
  const result = await apiCall<Envelope<{ profile: UserProfile }>>(
    "/settings/profile/picture",
    { method: "DELETE" },
  );
  return result.data.profile;
}

function displaySettingsResponse(value: unknown): DisplaySettings {
  const envelope = value as Envelope<{ settings?: DisplaySettings }> | null;
  const settings = envelope?.data?.settings;
  const layout = settings?.dashboardWidgets;
  const fields = ["theme", "currency", "locale", "timezone", "numberFormat", "dateFormat", "currencyPosition", "firstDayOfWeek", "viewMode"] as const;
  if (envelope?.success !== true || !settings || typeof settings !== "object" || Array.isArray(settings) || typeof settings.userId !== "string" ||
    fields.some(field => settings[field] != null && typeof settings[field] !== "string") ||
    (layout != null && (typeof layout !== "object" || Array.isArray(layout) ||
      ((Object.hasOwn(layout, "widgets") || Object.hasOwn(layout, "version")) &&
        (!Number.isFinite(layout.version) || !Array.isArray(layout.widgets) ||
          layout.widgets.some(widget => !widget || typeof widget !== "object" || typeof widget.id !== "string" || typeof widget.enabled !== "boolean" || (widget.label !== undefined && typeof widget.label !== "string"))))))) {
    throw new Error("Invalid display settings response. Please retry.");
  }
  return settings;
}

async function fetchDisplaySettings(): Promise<DisplaySettings> {
  const response = await protectedFetch("/api/settings/display", {
    credentials: "include",
  });

  await throwIfResNotOk(response);

  const data = await response.json();
  return displaySettingsResponse(data);
}

async function updateDisplaySettings(
  data: UpdateDisplaySettingsData,
): Promise<DisplaySettings> {
  const result = await apiCall<Envelope<{ settings: DisplaySettings }>>(
    "/settings/display",
    { method: "PUT", body: JSON.stringify(data) },
  );
  const settings = displaySettingsResponse(result);
  if (data.dashboardWidgets) {
    const stored = settings.dashboardWidgets;
    const sent = data.dashboardWidgets;
    if (!stored || stored.version !== sent.version || !Array.isArray(stored.widgets) || stored.widgets.length !== sent.widgets.length ||
      !stored.widgets.every((widget, index) => widget.id === sent.widgets[index].id && widget.label === sent.widgets[index].label && widget.enabled === sent.widgets[index].enabled)) {
      throw new Error("Dashboard layout was not acknowledged. Retry saving.");
    }
  }
  return settings;
}

// Hooks
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
    retry: false,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (data) => {
      queryClient.setQueryData(["profile"], data);
      toast.success("Profile updated successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to update profile", error);
    },
  });
}

export function useUploadProfilePicture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadProfilePicture,
    onSuccess: (data) => {
      queryClient.setQueryData(["profile"], data.profile);
      toast.success("Profile picture uploaded successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to upload profile picture", error);
    },
  });
}

export function useDeleteProfilePicture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProfilePicture,
    onSuccess: (data) => {
      queryClient.setQueryData(["profile"], data);
      toast.success("Profile picture removed");
    },
    onError: (error: Error) => {
      toastActionError("Failed to remove profile picture", error);
    },
  });
}

export function useDisplaySettings() {
  return useQuery({
    queryKey: ["displaySettings"],
    queryFn: fetchDisplaySettings,
    retry: false,
  });
}

export function useUpdateDisplaySettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateDisplaySettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["displaySettings"], data);
      toast.success("Display settings updated successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to update display settings", error);
    },
  });
}

// Helper function to generate initials from name
export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Notification Settings Types
export interface NotificationPreference {
  id: string;
  userId: string;
  notificationType: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  thresholdAmount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationPreferencesData {
  preferences: Array<{
    notificationType: string;
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
    pushEnabled?: boolean;
    thresholdAmount?: string | null;
  }>;
}

function notificationThresholdDecimal(value: unknown): Decimal | null {
  if (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() ? amount : null;
  } catch {
    return null;
  }
}

function isNotificationPreference(value: unknown): value is NotificationPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["id", "userId", "notificationType", "createdAt", "updatedAt"].every(field => {
    const entry = row[field];
    return typeof entry === "string" && entry.trim().length > 0;
  }) && ["inAppEnabled", "emailEnabled", "pushEnabled"].every(field => typeof row[field] === "boolean")
    && (row.thresholdAmount === null || notificationThresholdDecimal(row.thresholdAmount) !== null);
}

function validateNotificationAcknowledgement(
  data: UpdateNotificationPreferencesData,
  preferences: unknown,
  subject?: string,
): NotificationPreference[] {
  const error = new Error("Invalid notification preferences response");
  if (!Array.isArray(preferences)) throw error;
  const byType = new Map<string, NotificationPreference>();
  for (const row of preferences) {
    if (!isNotificationPreference(row) || byType.has(row.notificationType)
      || (subject !== undefined && row.userId !== subject)) throw error;
    byType.set(row.notificationType, row);
  }
  for (const patch of data.preferences) {
    const row = byType.get(patch.notificationType);
    if (!row) throw error;
    for (const field of ["inAppEnabled", "emailEnabled", "pushEnabled"] as const) {
      if (patch[field] !== undefined && row[field] !== patch[field]) throw error;
    }
    if (patch.thresholdAmount !== undefined) {
      if (patch.thresholdAmount === null) {
        if (row.thresholdAmount !== null) throw error;
      } else {
        const submitted = notificationThresholdDecimal(patch.thresholdAmount);
        const persisted = notificationThresholdDecimal(row.thresholdAmount);
        if (!submitted || !persisted || !submitted.equals(persisted)) throw error;
      }
    }
  }
  return Array.from(byType.values());
}

// API functions for notifications
async function fetchNotificationPreferences(): Promise<
  NotificationPreference[]
> {
  const response = await protectedFetch("/api/settings/notifications", {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const data = await response.json();
  return data.data.preferences;
}

async function updateNotificationPreferences(
  data: UpdateNotificationPreferencesData,
  operation: OperationLifetime | null = captureOperationLifetime(),
): Promise<NotificationPreference[]> {
  const result = await apiCall<
    Envelope<{ preferences: NotificationPreference[] }>
  >("/settings/notifications", { method: "PUT", body: JSON.stringify(data) }, true, false, operation);
  assertOperationLifetime(operation);
  return validateNotificationAcknowledgement(data, result?.data?.preferences, operation?.expectations?.subject);
}

// Hooks for notifications
export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notificationPreferences"],
    queryFn: fetchNotificationPreferences,
    retry: false,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateNotificationPreferencesData) => updateNotificationPreferences(data),
    onMutate: () => captureOperationLifetime(),
    onSuccess: (data, _variables, operation) => {
      if (captureOperationLifetime() !== operation) return;
      assertOperationLifetime(operation);
      queryClient.setQueryData<NotificationPreference[]>(["notificationPreferences"], previous => {
        const merged = [...(previous ?? [])];
        for (const row of data) {
          const index = merged.findIndex(pref => pref.notificationType === row.notificationType);
          if (index === -1) merged.push(row);
          else merged[index] = row;
        }
        return merged;
      });
      toast.success("Notification preferences updated successfully");
    },
  });
}

// ============================================================================
// SECURITY SETTINGS
// ============================================================================

export interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// Step-up gated. Routed through apiCall so a 401 STEP_UP_REQUIRED opens the
// password dialog and retries after re-auth. confirmPassword is required by the
// server's changePasswordSchema.
async function changePassword(data: ChangePasswordData): Promise<void> {
  await securityApi.changePassword(data);
}

export function useChangePassword() {
  return useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.success("Password changed successfully");
      invalidateSession();
    },
    onError: (error: Error) => {
      toastActionError("Failed to change password", error);
    },
  });
}

// Password strength calculator
export function calculatePasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;

  if (score <= 2) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 4) return { score, label: "Medium", color: "bg-yellow-500" };
  return { score, label: "Strong", color: "bg-green-500" };
}

// ============================================================================
// SESSION MANAGEMENT & LOGIN HISTORY
// ----------------------------------------------------------------------------
// Removed during the SCP-320 consolidation. These were unused duplicates of the
// canonical hooks in `@/hooks/useSecurity` (which the live SecuritySection
// uses). The old revokeAllOtherSessions here even POSTed to a non-existent
// /sessions/revoke-all route. Use useSecurity's useSessions / useRevokeSession /
// useRevokeAllOtherSessions / useLoginHistory instead.
// ============================================================================

// ============================================================================
// HOUSEHOLD SETTINGS
// ============================================================================

export interface Household {
  id: string;
  name: string;
  currency: string;
  fiscalYearStartMonth: number;
  /** IANA zone the owner chose for the household calendar; null until set. */
  timeZone?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdPreferences {
  householdId: string;
  defaultMonthOnlyChanges: boolean;
  autoRolloverBudget: boolean;
  rolloverPercentage: number;
  autoMarkReviewed: boolean;
  reviewThresholdAmount: string | null;
  showPendingTransactions: boolean;
  allowEditPending: boolean;
  displayMerchantLogos: boolean;
  defaultBudgetChangeScope: string;
  budgetTypeDefault: string;
  showZeroBalanceCategories: boolean;
  categorySorting: string;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdData {
  household: Household;
  preferences: HouseholdPreferences | null;
}

export interface CreateHouseholdData {
  name: string;
  currency?: string;
}

export interface UpdateHouseholdData {
  name?: string;
  currency?: string;
  fiscalYearStartMonth?: number;
}

// API functions for household
//
// FIX P7b-3: this used to be a bare fetch() that only ever surfaced
// `error.message`, so Dashboard.tsx's "does this user have a household yet"
// onboarding gate had nothing to key off except substring-matching that
// message. Routing through apiCall attaches the real `code` (e.g.
// "HOUSEHOLD_NOT_FOUND") and HTTP `status` to the thrown error (see
// ApiError in lib/api.ts), so callers can branch structurally instead.
async function fetchHousehold(): Promise<HouseholdData> {
  const result = await apiCall<Envelope<HouseholdData>>("/household/general");
  return result.data;
}

async function createHousehold(
  data: CreateHouseholdData,
): Promise<HouseholdData> {
  const result = await apiCall<Envelope<HouseholdData>>("/household", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return result.data;
}

async function updateHousehold(data: UpdateHouseholdData): Promise<Household> {
  const result = await apiCall<Envelope<{ household: Household }>>(
    "/household/general",
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.household;
}

// Hooks for household
export function useHousehold() {
  return useQuery({
    queryKey: ["household"],
    queryFn: fetchHousehold,
    retry: false,
  });
}

export function useCreateHousehold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createHousehold,
    onSuccess: (data) => {
      queryClient.setQueryData(["household"], data);
      invalidateSession();
      toast.success("Household created successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to create household", error);
    },
  });
}

export function useUpdateHousehold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateHousehold,
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["household"],
        (old: HouseholdData | undefined) => ({
          ...old,
          household: data,
        }),
      );
      toast.success("Household updated successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to update household", error);
    },
  });
}

// ============================================================================
// HOUSEHOLD MEMBERS
// ============================================================================

// AH-05: the flat GET /api/household/members DTO, shared with the server.
export type { HouseholdMemberDto as HouseholdMember } from "@shared/household-members";

// API functions for members
async function fetchHouseholdMembers(): Promise<HouseholdMember[]> {
  const response = await protectedFetch("/api/household/members", {
    credentials: "include",
  });

  await throwIfResNotOk(response);

  const data = await response.json();
  return data.data.members;
}

async function updateMemberRole(data: {
  userId: string;
  role: HouseholdRole;
}): Promise<void> {
  await apiCall<Envelope<unknown>>(
    `/household/members/${data.userId}/role`,
    { method: "PUT", body: JSON.stringify({ role: data.role }) },
  );
}

async function removeMember(userId: string): Promise<void> {
  await apiCall<Envelope<unknown>>(`/household/members/${userId}`, {
    method: "DELETE",
  });
}

// Hooks for members
export function useHouseholdMembers() {
  return useQuery({
    queryKey: ["householdMembers"],
    queryFn: fetchHouseholdMembers,
    retry: false,
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMemberRole,
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["householdMembers"] });

      // Snapshot the previous value
      const previousMembers = queryClient.getQueryData<HouseholdMember[]>([
        "householdMembers",
      ]);

      // Optimistically update the cache
      if (previousMembers) {
        queryClient.setQueryData<HouseholdMember[]>(
          ["householdMembers"],
          previousMembers.map((member) =>
            member.userId === variables.userId
              ? { ...member, role: variables.role }
              : member,
          ),
        );
      }

      // Return context with snapshot
      return { previousMembers };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["householdMembers"] });
      toast.success("Member role updated successfully");
      invalidateSession();
    },
    onError: (error: Error, _variables, context) => {
      // Rollback to previous value on error
      if (context?.previousMembers) {
        queryClient.setQueryData(["householdMembers"], context.previousMembers);
      }
      toastActionError("Failed to update member role", error);
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeMember,
    onMutate: async (userId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["householdMembers"] });

      // Snapshot previous value
      const previousMembers = queryClient.getQueryData<HouseholdMember[]>([
        "householdMembers",
      ]);

      // Optimistically remove the member
      if (previousMembers) {
        queryClient.setQueryData<HouseholdMember[]>(
          ["householdMembers"],
          previousMembers.filter((member) => member.userId !== userId)
        );
      }

      return { previousMembers };
    },
    onSuccess: () => {
      toast.success("Member removed successfully");
      invalidateSession();
    },
    onError: (error: Error, _userId, context) => {
      // Rollback on error
      if (context?.previousMembers) {
        queryClient.setQueryData(["householdMembers"], context.previousMembers);
      }
      toastActionError("Failed to remove member", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["householdMembers"] });
    },
  });
}

// Invite, transfer and leave: hooks/use-household-membership.ts.

// ============================================================================
// CATEGORIES
// ============================================================================

export interface CategoryGroup {
  id: string;
  householdId: string;
  name: string;
  type: string;
  budgetMode: string;
  rolloverEnabled: boolean;
  isArchived: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  householdId: string;
  groupId: string;
  name: string;
  icon: string | null;
  color: string | null;
  includeInBudget: boolean;
  rolloverEnabled?: boolean;
  rolloverStartBalance?: string | null;
  isArchived: boolean;
  displayOrder: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  groupName?: string | null;
  groupType?: string | null;
  budget?: number;
  spent?: number;
  transactionCount?: number;
}

export interface CategoriesQuery {
  includeArchived?: boolean;
  includeStats?: boolean;
  month?: number;
  year?: number;
  type?: string;
}

export interface CreateCategoryData {
  groupId: string;
  name: string;
  icon?: string;
  color?: string;
  includeInBudget?: boolean;
  rolloverEnabled?: boolean;
  rolloverStartBalance?: string | null;
}

export interface UpdateCategoryData {
  name?: string;
  icon?: string;
  color?: string;
  includeInBudget?: boolean;
  groupId?: string;
  rolloverEnabled?: boolean;
  rolloverStartBalance?: string | null;
  isArchived?: boolean;
}

async function fetchCategories(params?: CategoriesQuery): Promise<{
  categories: Category[];
  groups: CategoryGroup[];
}> {
  const searchParams = new URLSearchParams();
  if (params?.includeArchived) searchParams.set("includeArchived", "true");
  if (params?.includeStats) searchParams.set("includeStats", "true");
  if (params?.month) searchParams.set("month", String(params.month));
  if (params?.year) searchParams.set("year", String(params.year));
  if (params?.type) searchParams.set("type", params.type);

  const url = searchParams.toString()
    ? `/api/categories?${searchParams.toString()}`
    : "/api/categories";

  const response = await protectedFetch(url, {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const data = await response.json();
  return data.data;
}

async function createCategory(data: CreateCategoryData): Promise<Category> {
  const result = await apiCall<Envelope<{ category: Category }>>(
    "/categories",
    { method: "POST", body: JSON.stringify(data) },
  );
  return result.data.category;
}

async function updateCategory(
  id: string,
  data: UpdateCategoryData,
): Promise<Category> {
  const result = await apiCall<Envelope<{ category: Category }>>(
    `/categories/${id}`,
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.category;
}

async function deleteCategory(id: string): Promise<void> {
  await apiCall<Envelope<unknown>>(`/categories/${id}`, { method: "DELETE" });
}

async function reorderCategories(
  categories: Array<{ id: string; displayOrder: number }>,
): Promise<void> {
  await apiCall<Envelope<unknown>>("/categories/reorder", {
    method: "PUT",
    body: JSON.stringify({ categories }),
  });
}

export function useCategories(params?: CategoriesQuery) {
  const key = params ? JSON.stringify(params) : "default";
  return useQuery({
    queryKey: ["categories", key],
    queryFn: () => fetchCategories(params),
    retry: false,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category created successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to create category", error);
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryData }) =>
      updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category updated successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to update category", error);
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category removed successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to remove category", error);
    },
  });
}

export function useReorderCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reorderCategories,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categories reordered successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to reorder categories", error);
    },
  });
}

export function useSeedCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () =>
      apiCall<Envelope<unknown>>("/categories/seed", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Default categories created successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to seed categories", error);
    },
  });
}

export interface CreateCategoryGroupData {
  name: string;
  type: "expenses" | "income" | "transfers";
  budgetMode?: "by_category" | "by_group";
  rolloverEnabled?: boolean;
}

export interface UpdateCategoryGroupData {
  name?: string;
  type?: "expenses" | "income" | "transfers";
  budgetMode?: "by_category" | "by_group";
  rolloverEnabled?: boolean;
  isArchived?: boolean;
}

async function createCategoryGroup(
  data: CreateCategoryGroupData,
): Promise<CategoryGroup> {
  const result = await apiCall<Envelope<{ group: CategoryGroup }>>(
    "/categories/groups",
    { method: "POST", body: JSON.stringify(data) },
  );
  return result.data.group;
}

async function updateCategoryGroup(
  id: string,
  data: UpdateCategoryGroupData,
): Promise<CategoryGroup> {
  const result = await apiCall<Envelope<{ group: CategoryGroup }>>(
    `/categories/groups/${id}`,
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.group;
}

async function archiveCategoryGroup(id: string): Promise<CategoryGroup> {
  const result = await apiCall<Envelope<{ group: CategoryGroup }>>(
    `/categories/groups/${id}`,
    { method: "DELETE" },
  );
  return result.data.group;
}

async function restoreCategoryGroup(id: string): Promise<CategoryGroup> {
  const result = await apiCall<Envelope<{ group: CategoryGroup }>>(
    `/categories/groups/${id}/restore`,
    { method: "PUT" },
  );
  return result.data.group;
}

async function reorderCategoryGroups(
  groups: Array<{ id: string; displayOrder: number }>,
): Promise<void> {
  await apiCall<Envelope<unknown>>("/categories/groups/reorder", {
    method: "PUT",
    body: JSON.stringify({ groups }),
  });
}

export function useCreateCategoryGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCategoryGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category group created successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to create category group", error);
    },
  });
}

export function useUpdateCategoryGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryGroupData }) =>
      updateCategoryGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category group updated successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to update category group", error);
    },
  });
}

export function useArchiveCategoryGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archiveCategoryGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category group archived successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to archive category group", error);
    },
  });
}

export function useRestoreCategoryGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: restoreCategoryGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category group restored successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to restore category group", error);
    },
  });
}

export function useReorderCategoryGroups() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reorderCategoryGroups,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category groups reordered successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to reorder category groups", error);
    },
  });
}

// ============================================================================
// MERCHANTS
// ============================================================================

export interface Merchant {
  id: string;
  householdId: string;
  name: string;
  logoUrl: string | null;
  category?: string | null;
  defaultCategoryId?: string | null;
  notes?: string | null;
  isActive?: boolean | null;
  iconType?: string | null;
  customIcon?: string | null;
  transactionCount: number;
  lastTransactionDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateMerchantData {
  name?: string;
  logoUrl?: string | null;
  category?: string | null;
  defaultCategoryId?: string | null;
  notes?: string | null;
  isActive?: boolean;
  iconType?: string | null;
  customIcon?: string | null;
}

export interface CreateMerchantData {
  name: string;
  logoUrl?: string | null;
  category?: string | null;
  defaultCategoryId?: string | null;
  notes?: string | null;
  isActive?: boolean;
  iconType?: string | null;
  customIcon?: string | null;
}

export interface MerchantAlias {
  id: string;
  merchantId: string;
  aliasName: string;
  createdAt: string;
}

export interface MerchantDetailResponse {
  merchant: Merchant;
  aliases: MerchantAlias[];
}

/** GET /merchants/:id/analytics. Amounts are in the household currency. */
export interface MerchantAnalytics {
  totalSpent: MoneyDto;
  transactionCount: number;
  averageTransaction: MoneyDto;
  trend: Array<{ period: string; total: MoneyDto; count: number }>;
}

export interface MerchantTransactionsResponse {
  transactions: Array<{
    id: string;
    date: string;
    name: string;
    type: string;
    /** In the household currency. */
    amount: MoneyDto;
    isPending: boolean;
    notes?: string | null;
    accountId: string;
  }>;
  /** `count` is the number of matching rows across all pages. */
  pagination: { limit: number; offset: number; count: number };
}

export interface MerchantDuplicateGroup {
  merchants: Merchant[];
  similarity: number;
}

export interface MerchantMergeHistoryItem {
  id: string;
  sourceMerchantId: string;
  sourceMerchantName: string;
  targetMerchantId: string;
  targetMerchantName?: string | null;
  mergedAt?: string | null;
  canUndo: boolean;
  undoExpiresAt?: string | null;
}

async function fetchMerchants(): Promise<Merchant[]> {
  const response = await protectedFetch("/api/merchants", {
    credentials: "include",
  });
  await throwIfResNotOk(response);

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error(
      "Server returned non-JSON response. Please ensure you are logged in.",
    );
  }



  const data = await response.json();
  return data.data?.merchants || [];
}

async function fetchMerchantAutocomplete(
  query: string,
  limit = 25,
): Promise<Merchant[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  const response = await protectedFetch(`/api/merchants/autocomplete?${params}`, {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const result = await response.json();
  return result.data?.merchants || [];
}

async function fetchMerchantDetails(
  id: string,
): Promise<MerchantDetailResponse> {
  const response = await protectedFetch(`/api/merchants/${id}`, {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const result = await response.json();
  return result.data;
}

async function fetchMerchantDuplicates(): Promise<MerchantDuplicateGroup[]> {
  const response = await protectedFetch("/api/merchants/duplicates", {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const result = await response.json();
  return result.data?.groups || [];
}

async function addMerchantAlias(
  merchantId: string,
  aliasName: string,
): Promise<MerchantAlias> {
  const result = await apiCall<Envelope<{ alias: MerchantAlias }>>(
    `/merchants/${merchantId}/aliases`,
    { method: "POST", body: JSON.stringify({ aliasName }) },
  );
  return result.data.alias;
}

async function deleteMerchantAlias(
  merchantId: string,
  aliasId: string,
): Promise<void> {
  await apiCall<Envelope<unknown>>(
    `/merchants/${merchantId}/aliases/${aliasId}`,
    { method: "DELETE" },
  );
}

async function createMerchant(data: CreateMerchantData): Promise<Merchant> {
  const result = await apiCall<Envelope<{ merchant: Merchant }>>(
    "/merchants",
    { method: "POST", body: JSON.stringify(data) },
  );
  return result.data.merchant;
}

async function updateMerchant(
  id: string,
  data: UpdateMerchantData,
): Promise<Merchant> {
  const result = await apiCall<Envelope<{ merchant: Merchant }>>(
    `/merchants/${id}`,
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.merchant;
}

/** What DELETE /merchants/:id does: archive (merge has its own endpoint). */
export interface MerchantArchiveResult {
  merchant: Merchant;
  action: "archive";
  keptTransactionCount: number;
}

async function deleteMerchant(
  id: string,
  options?: { action?: "soft" },
): Promise<MerchantArchiveResult> {
  const query = options?.action ? `?action=${options.action}` : "";
  const result = await apiCall<Envelope<MerchantArchiveResult>>(
    `/merchants/${id}${query}`,
    { method: "DELETE" },
  );
  return result.data;
}

async function fetchMerchantAnalytics(
  id: string,
  params?: { startDate?: string; endDate?: string; groupBy?: "day" | "month" },
): Promise<MerchantAnalytics> {
  const query = new URLSearchParams();
  if (params?.startDate) query.set("startDate", params.startDate);
  if (params?.endDate) query.set("endDate", params.endDate);
  if (params?.groupBy) query.set("groupBy", params.groupBy);
  const queryStr = query.toString();

  const response = await protectedFetch(
    `/api/merchants/${id}/analytics${queryStr ? `?${queryStr}` : ""}`,
    { credentials: "include" },
  );
  await throwIfResNotOk(response);



  const result = await response.json();
  return result.data;
}

async function fetchMerchantTransactions(
  id: string,
  params?: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    categoryId?: string;
    minAmount?: number;
    maxAmount?: number;
  },
): Promise<MerchantTransactionsResponse> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  if (params?.startDate) query.set("startDate", params.startDate);
  if (params?.endDate) query.set("endDate", params.endDate);
  if (params?.categoryId) query.set("categoryId", params.categoryId);
  if (params?.minAmount !== undefined) {
    query.set("minAmount", String(params.minAmount));
  }
  if (params?.maxAmount !== undefined) {
    query.set("maxAmount", String(params.maxAmount));
  }
  const queryStr = query.toString();

  const response = await protectedFetch(
    `/api/merchants/${id}/transactions${queryStr ? `?${queryStr}` : ""}`,
    { credentials: "include" },
  );
  await throwIfResNotOk(response);



  const result = await response.json();
  return result.data;
}

async function uploadMerchantLogo(
  id: string,
  file: File,
): Promise<{ merchant: Merchant; logoUrl: string }> {
  const formData = new FormData();
  formData.append("logo", file);

  const result = await apiCall<
    Envelope<{ merchant: Merchant; logoUrl: string }>
  >(`/merchants/${id}/logo`, { method: "POST", body: formData });
  return result.data;
}

async function deleteMerchantLogo(id: string): Promise<Merchant> {
  const result = await apiCall<Envelope<{ merchant: Merchant }>>(
    `/merchants/${id}/logo`,
    { method: "DELETE" },
  );
  return result.data.merchant;
}
async function mergeMerchants(
  sourceId: string,
  targetId: string,
): Promise<{ mergeHistoryId?: string; targetMerchantId?: string }> {
  const result = await apiCall<
    Envelope<{ mergeHistoryId?: string; targetMerchantId?: string }>
  >(`/merchants/${sourceId}/merge`, {
    method: "POST",
    body: JSON.stringify({ targetMerchantId: targetId }),
  });
  return result.data || {};
}

async function fetchMerchantMergeHistory(): Promise<
  MerchantMergeHistoryItem[]
> {
  const response = await protectedFetch("/api/merchants/merge/history", {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const result = await response.json();
  return result.data?.history || [];
}

async function undoMerchantMerge(historyId: string): Promise<void> {
  await apiCall<Envelope<unknown>>(`/merchants/merge/${historyId}/undo`, {
    method: "POST",
  });
}

export function useMerchants() {
  return useQuery({
    queryKey: ["merchants"],
    queryFn: fetchMerchants,
    retry: false,
  });
}

export function useMerchantAutocomplete(query: string, limit = 25) {
  return useQuery({
    queryKey: ["merchants", "autocomplete", query, limit],
    queryFn: () => fetchMerchantAutocomplete(query, limit),
    enabled: query.trim().length > 0,
    retry: false,
  });
}

export function useMerchantDetails(id?: string) {
  return useQuery({
    queryKey: ["merchants", "detail", id],
    queryFn: () => fetchMerchantDetails(id || ""),
    enabled: !!id,
    retry: false,
  });
}

export function useMerchantDuplicates() {
  return useQuery({
    queryKey: ["merchants", "duplicates"],
    queryFn: fetchMerchantDuplicates,
    retry: false,
  });
}

export function useMerchantMergeHistory() {
  return useQuery({
    queryKey: ["merchants", "merge-history"],
    queryFn: fetchMerchantMergeHistory,
    retry: false,
  });
}

export function useMerchantAnalytics(
  id?: string,
  params?: { startDate?: string; endDate?: string; groupBy?: "day" | "month" },
) {
  return useQuery({
    queryKey: ["merchants", "analytics", id, params],
    queryFn: () => fetchMerchantAnalytics(id || "", params),
    enabled: !!id,
    retry: false,
  });
}

export function useMerchantTransactions(
  id?: string,
  params?: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    categoryId?: string;
    minAmount?: number;
    maxAmount?: number;
  },
) {
  return useQuery({
    queryKey: ["merchants", "transactions", id, params],
    queryFn: () => fetchMerchantTransactions(id || "", params),
    enabled: !!id,
    retry: false,
  });
}

export function useCreateMerchant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMerchant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Merchant created successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to create merchant", error);
    },
  });
}

export function useUpdateMerchant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMerchantData }) =>
      updateMerchant(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Merchant updated successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to update merchant", error);
    },
  });
}

export function useDeleteMerchant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      options,
    }: {
      id: string;
      options?: { action?: "soft" };
    }) => deleteMerchant(id, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Merchant archived");
    },
    onError: (error: Error) => {
      toastActionError("Failed to delete merchant", error);
    },
  });
}

export function useAddMerchantAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      merchantId,
      aliasName,
    }: {
      merchantId: string;
      aliasName: string;
    }) => addMerchantAlias(merchantId, aliasName),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["merchants", "detail", variables.merchantId],
      });
      toast.success("Alias added");
    },
    onError: (error: Error) => {
      toastActionError("Failed to add alias", error);
    },
  });
}

export function useDeleteMerchantAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      merchantId,
      aliasId,
    }: {
      merchantId: string;
      aliasId: string;
    }) => deleteMerchantAlias(merchantId, aliasId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["merchants", "detail", variables.merchantId],
      });
      toast.success("Alias removed");
    },
    onError: (error: Error) => {
      toastActionError("Failed to remove alias", error);
    },
  });
}

export function useUploadMerchantLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      uploadMerchantLogo(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Logo uploaded");
    },
    onError: (error: Error) => {
      toastActionError("Failed to upload logo", error);
    },
  });
}

export function useDeleteMerchantLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteMerchantLogo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Logo removed");
    },
    onError: (error: Error) => {
      toastActionError("Failed to remove logo", error);
    },
  });
}

export function useMergeMerchants() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sourceId,
      targetId,
    }: {
      sourceId: string;
      targetId: string;
    }) => mergeMerchants(sourceId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      queryClient.invalidateQueries({ queryKey: ["merchants", "duplicates"] });
      queryClient.invalidateQueries({
        queryKey: ["merchants", "merge-history"],
      });
      toast.success("Merchants merged successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to merge merchants", error);
    },
  });
}

export function useUndoMerchantMerge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: undoMerchantMerge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      queryClient.invalidateQueries({ queryKey: ["merchants", "duplicates"] });
      queryClient.invalidateQueries({
        queryKey: ["merchants", "merge-history"],
      });
      toast.success("Merge undone");
    },
    onError: (error: Error) => {
      toastActionError("Failed to undo merge", error);
    },
  });
}

// ============================================================================
// RULES
// ============================================================================

// Import shared types to ensure consistency
import type {
  ConditionType,
  Operator,
  ActionType,
} from "../features/settings/constants/ruleConditions";

// RuleCondition type matches server/services/rule/types.ts
export interface RuleCondition {
  type: ConditionType;
  operator: Operator;
  value: string | number | string[];
  value2?: string | number;
  enabled?: boolean;
}

export interface SplitConfig {
  categoryId?: string;
  amount?: string; // decimal money string ("25.00"), never a float
  percentage?: number;
  note?: string;
  merchantName?: string;
}

// RuleAction type matches server/services/rule/types.ts
export interface RuleAction {
  type: ActionType;
  value: string | string[];
  enabled?: boolean;
  splitConfig?: SplitConfig[];
}

export interface Rule {
  id: string;
  householdId: string;
  name: string;
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";
  actions: RuleAction[];
  enabled: boolean;
  applyToPast: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
  matchCount?: number;
  splitConfig?: SplitConfig[];
}

export interface CreateRuleData {
  name: string;
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";
  actions: RuleAction[];
  enabled?: boolean;
  applyToPast?: boolean;
}

export interface UpdateRuleData {
  name?: string;
  conditions?: RuleCondition[];
  conditionLogic?: "all" | "any";
  actions?: RuleAction[];
  enabled?: boolean;
  applyToPast?: boolean;
  priority?: number;
}

async function fetchRules(): Promise<Rule[]> {
  const response = await protectedFetch("/api/rules", {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const data = await response.json();
  return data.data.rules;
}

/** A saved rule and, when it was applied to past transactions, what that did (A-32). */
export interface RuleSaveResult {
  rule: Rule;
  applied?: RuleApplyOutcome;
}

async function createRule(data: CreateRuleData): Promise<RuleSaveResult> {
  const result = await apiCall<Envelope<RuleSaveResult>>("/rules", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return result.data;
}

async function updateRule(id: string, data: UpdateRuleData): Promise<RuleSaveResult> {
  const result = await apiCall<Envelope<RuleSaveResult>>(`/rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return result.data;
}

async function deleteRule(id: string): Promise<void> {
  await apiCall<Envelope<unknown>>(`/rules/${id}`, { method: "DELETE" });
}

// How many matches the Test button asks the server to count. The server caps
// `limit` at 100 (previewSchema in server/modules/rules/rules.controller.ts).
export const RULE_TEST_MATCH_LIMIT = 100;

export interface RuleTestResult {
  matchCount: number;
  totalChecked: number;
  /** True when the server stopped counting at the limit. */
  isCapped: boolean;
}

// The server has no per-rule "test" route: a saved rule is tested by
// previewing its stored conditions through POST /rules/preview.
async function testRule(
  rule: Pick<Rule, "conditions" | "conditionLogic">,
): Promise<RuleTestResult> {
  const result = await previewRule({
    conditions: rule.conditions,
    conditionLogic: rule.conditionLogic,
    limit: RULE_TEST_MATCH_LIMIT,
  });
  return {
    matchCount: result.count,
    totalChecked: result.totalChecked,
    isCapped: result.count >= RULE_TEST_MATCH_LIMIT,
  };
}

// PUT /rules/reorder expects { rules: [{ id, priority }] } (rules.controller.ts).
async function reorderRules(ruleIds: string[]): Promise<void> {
  await apiCall<Envelope<unknown>>("/rules/reorder", {
    method: "PUT",
    body: JSON.stringify({
      rules: ruleIds.map((id, priority) => ({ id, priority })),
    }),
  });
}

export interface RulePreviewTransaction {
  id: string;
  name: string;
  date: string;
  type: string;
  amount: string | number;
  categoryId?: string | null;
}

// Default match limit of rulesController.preview (previewSchema.limit); the
// editor sends it explicitly so a count at the limit can be shown as a lower bound.
export const RULE_PREVIEW_LIMIT = 20;

// Mirrors the data returned by rulesController.preview (the V7 envelope's
// `data`): matches come back as `matchingTransactions`, with `count` and
// `totalChecked` (not `transactions` / `matchCount` / `totalScanned`).
export interface RulePreviewResult {
  matchingTransactions: RulePreviewTransaction[];
  count: number;
  totalChecked: number;
}

async function previewRule(data: {
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";
  limit?: number;
}): Promise<RulePreviewResult> {
  const result = await apiCall<Envelope<RulePreviewResult>>("/rules/preview", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return result.data;
}

export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    retry: false,
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createRule,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      announceRuleSave("created", result.applied);
    },
    onError: (error: Error) => {
      toastActionError("Failed to create rule", error);
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRuleData }) =>
      updateRule(id, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      announceRuleSave("updated", result.applied);
    },
    onError: (error: Error) => {
      toastActionError("Failed to update rule", error);
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Rule deleted successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to delete rule", error);
    },
  });
}

export function useTestRule() {
  return useMutation({
    mutationFn: testRule,
    onSuccess: (data) => {
      const count = data.isCapped ? `${data.matchCount}+` : `${data.matchCount}`;
      toast.success(
        `Rule matches ${count} of the ${data.totalChecked} most recent transactions`,
      );
    },
    onError: (error: Error) => {
      toastActionError("Failed to test rule", error);
    },
  });
}

export function useReorderRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reorderRules,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Rules reordered successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to reorder rules", error);
    },
  });
}

export function usePreviewRule() {
  return useMutation({
    mutationFn: previewRule,
  });
}

// ============================================================================
// SEED MERCHANTS
// ============================================================================

export function useSeedMerchants() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () =>
      apiCall<Envelope<unknown>>("/merchants/seed", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Zambian merchants created successfully");
    },
    onError: (error: Error) => {
      toastActionError("Failed to seed merchants", error);
    },
  });
}
// ============================================================================
// USER PREFERENCES
// ============================================================================

export type UserPreferences = UserPreferencesResponse;
export type UpdateUserPreferencesData = UserPreferencesPatch;
export type UpdatePersonalPreference = <K extends keyof UserPreferencesPatch>(key: K, value: UserPreferencesResponse[K]) => void;

function personalPreferencesResponse(value: unknown, operation: OperationLifetime | null): UserPreferences {
  assertOperationLifetime(operation);
  const parsed = userPreferencesEnvelopeSchema.safeParse(value);
  if (!parsed.success || (operation?.expectations && parsed.data.data.preferences.userId !== operation.expectations.subject)) {
    throw new Error("Invalid personal preferences response. Please retry.");
  }
  return parsed.data.data.preferences;
}

async function updateUserPreferences(
  data: UpdateUserPreferencesData,
  operation: OperationLifetime | null,
): Promise<UserPreferences> {
  assertOperationLifetime(operation);
  const patch = userPreferencesPatchSchema.parse(data);
  const result = await apiCall<unknown>(
    "/settings/user-preferences",
    { method: "PUT", body: JSON.stringify(patch) }, true, false, operation,
  );
  const preferences = personalPreferencesResponse(result, operation);
  if (Object.entries(patch).some(([field, value]) => preferences[field as keyof UserPreferences] !== value)) {
    throw new Error("Personal preference changes were not acknowledged. Please retry.");
  }
  return preferences;
}

export function useUserPreferences() {
  const operation = useRef(captureOperationLifetime());
  return useQuery({
    queryKey: ["userPreferences"],
    queryFn: async ({ signal }) => {
      const response = await protectedFetch("/api/settings/user-preferences", { credentials: "include", signal }, operation.current);
      await throwIfResNotOk(response);
      return personalPreferencesResponse(await response.json(), operation.current);
    },
    retry: false,
  });
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  const operation = useRef(captureOperationLifetime());

  return useMutation({
    scope: { id: "personal-user-preferences" },
    onMutate: async () => {
      assertOperationLifetime(operation.current);
      await queryClient.cancelQueries({ queryKey: ["userPreferences"] });
      assertOperationLifetime(operation.current);
    },
    mutationFn: (data: UpdateUserPreferencesData) => updateUserPreferences(data, operation.current),
    onSuccess: (data) => {
      assertOperationLifetime(operation.current);
      queryClient.setQueryData(["userPreferences"], data);
      toast.success("Preferences updated successfully");
    },
    onError: (error: Error) => {
      try { assertOperationLifetime(operation.current); } catch { return; }
      toastActionError("Failed to update preferences", error);
    },
  });
}

// ============================================================================
// AI CONSENT
// ============================================================================
//
// FIX (packet R4): the "AI Features" settings card previously called
// /api/settings/ai-preferences, which does not exist on the server. The real
// consent management endpoints live in the AI module
// (server/modules/ai/ai.routes.ts): GET/POST /api/ai/consent. Consent is a
// single household-wide flag (households.aiConsentGiven), not a set of
// per-feature toggles, and granting/revoking requires the admin role
// (SEC-RBAC-001).
//
// Both endpoints return their payload as raw JSON, NOT the V7
// { success, data } envelope (verified against ai.controller.ts getConsent/
// setConsent and the response-shape assertions in ai.integration.test.ts).

export interface AIConsentStatus {
  consentGiven: boolean;
  consentDate: string | null;
  consentVersion: string | null;
  currentVersion: string;
  needsReconsent: boolean;
}

/**
 * One consent decision. A grant names the disclosure version the actor was
 * shown (Astra #255 r3); the server refuses a stale or missing one.
 */
export type AIConsentDecision =
  | { consentGiven: true; consentVersion: string }
  | { consentGiven: false };

export interface UpdateAIConsentResponse {
  consentGiven: boolean;
  consentDate: string;
  consentVersion: string | null;
}

async function fetchAIConsent(): Promise<AIConsentStatus> {
  return apiCall<AIConsentStatus>("/ai/consent");
}

async function updateAIConsent(
  decision: AIConsentDecision,
): Promise<UpdateAIConsentResponse> {
  return apiCall<UpdateAIConsentResponse>("/ai/consent", {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

export function useAIConsent() {
  return useQuery({
    queryKey: ["aiConsent"],
    queryFn: fetchAIConsent,
    retry: false,
  });
}

export function useUpdateAIConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateAIConsent,
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["aiConsent"],
        (previous?: AIConsentStatus): AIConsentStatus => ({
          consentGiven: data.consentGiven,
          consentDate: data.consentDate,
          consentVersion: data.consentVersion,
          currentVersion:
            previous?.currentVersion ?? data.consentVersion ?? "v1.0",
          needsReconsent: false,
        }),
      );
      toast.success(
        data.consentGiven ? "AI features enabled" : "AI features disabled",
      );
    },
    onError: (error: Error) => {
      toastActionError("Failed to update AI consent", error);
    },
  });
}

// ============================================================================
// COMPOSITE SETTINGS HOOK
// ============================================================================

/**
 * Combined settings hook that provides common settings values
 * Used by components that need basic settings like currency
 */
export function useSettings() {
  const householdQuery = useHousehold();
  const displayQuery = useDisplaySettings();

  return {
    currency: householdQuery.data?.household?.currency || displayQuery.data?.currency || 'USD',
    isLoading: householdQuery.isLoading || displayQuery.isLoading,
    error: householdQuery.error || displayQuery.error,
  };
}
