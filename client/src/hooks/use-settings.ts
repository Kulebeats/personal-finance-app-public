import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DashboardWidgetsPreferences } from "@shared/schema";
// apiCall attaches x-csrf-token to every mutating request (and self-heals on a
// stale token), so all mutations below MUST go through it — raw fetch 403s in
// any real browser session (server/app.ts CSRF middleware).
import { apiCall, securityApi } from "@/lib/api";

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
  salaryRangeEncrypted: string | null;
  // Metadata
  profileCompleteness: number;
  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface Address {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

export interface UpdateProfileData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  birthday?: string;
  birthdayHideYear?: boolean;
  gender?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  phoneNumberWork?: string;
  phoneNumberHome?: string;
  address?: Address;
  occupation?: string;
  occupationCustom?: boolean;
  company?: string;
  timezone?: string;
  profilePictureUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string;
  socialLinks?: Record<string, string>;
  nrc?: string;
  annualIncome?: string;
  incomeFrequency?: string;
  employmentStatus?: string;
  investmentGoal?: string;
  riskTolerance?: string;
  salaryRangeEncrypted?: string;
  profileCompleteness?: number;
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
  const response = await fetch("/api/settings/profile", {
    credentials: "include",
  });

  if (!response.ok) {
    let errorBody: { error?: { message?: string } } | null = null;
    try {
      errorBody = await response.json();
    } catch (error) {
      errorBody = null;
    }
    const message = errorBody?.error?.message || "Failed to fetch profile";
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

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

async function fetchDisplaySettings(): Promise<DisplaySettings> {
  const response = await fetch("/api/settings/display", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch display settings");
  }

  const data = await response.json();
  return data.data.settings;
}

async function updateDisplaySettings(
  data: UpdateDisplaySettingsData,
): Promise<DisplaySettings> {
  const result = await apiCall<Envelope<{ settings: DisplaySettings }>>(
    "/settings/display",
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.settings;
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
      toast.error(error.message || "Failed to update profile");
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
      toast.error(error.message || "Failed to upload profile picture");
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
      toast.error(error.message || "Failed to remove profile picture");
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
      toast.error(error.message || "Failed to update display settings");
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

// API functions for notifications
async function fetchNotificationPreferences(): Promise<
  NotificationPreference[]
> {
  const response = await fetch("/api/settings/notifications", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error?.message || "Failed to fetch notification preferences",
    );
  }

  const data = await response.json();
  return data.data.preferences;
}

async function updateNotificationPreferences(
  data: UpdateNotificationPreferencesData,
): Promise<NotificationPreference[]> {
  const result = await apiCall<
    Envelope<{ preferences: NotificationPreference[] }>
  >("/settings/notifications", { method: "PUT", body: JSON.stringify(data) });
  return result.data.preferences;
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
    mutationFn: updateNotificationPreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(["notificationPreferences"], data);
      toast.success("Notification preferences updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update notification preferences");
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
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to change password");
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
      toast.success("Household created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create household");
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
      toast.error(error.message || "Failed to update household");
    },
  });
}

// ============================================================================
// HOUSEHOLD MEMBERS
// ============================================================================

export interface HouseholdMember {
  id: string;
  householdId: string;
  userId: string;
  role: string;
  joinedAt: string;
  lastActiveAt: string | null;
  user: {
    id: string;
    username: string;
    email: string;
    fullName: string | null;
    profilePictureUrl: string | null;
    lastLoginAt: string | null;
  } | null;
}

// API functions for members
async function fetchHouseholdMembers(): Promise<HouseholdMember[]> {
  const response = await fetch("/api/household/members", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch members");
  }

  const data = await response.json();
  return data.data.members;
}

async function updateMemberRole(data: {
  userId: string;
  role: string;
}): Promise<HouseholdMember> {
  const result = await apiCall<Envelope<{ member: HouseholdMember }>>(
    `/household/members/${data.userId}/role`,
    { method: "PUT", body: JSON.stringify({ role: data.role }) },
  );
  return result.data.member;
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
    },
    onError: (error: Error, _variables, context) => {
      // Rollback to previous value on error
      if (context?.previousMembers) {
        queryClient.setQueryData(["householdMembers"], context.previousMembers);
      }
      toast.error(error.message || "Failed to update member role");
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
    },
    onError: (error: Error, _userId, context) => {
      // Rollback on error
      if (context?.previousMembers) {
        queryClient.setQueryData(["householdMembers"], context.previousMembers);
      }
      toast.error(error.message || "Failed to remove member");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["householdMembers"] });
    },
  });
}

async function addMember(data: {
  emailOrUsername: string;
  role: string;
}): Promise<void> {
  await apiCall<Envelope<unknown>>("/household/members", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function useAddMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["householdMembers"] });
      toast.success("Member added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add member");
    },
  });
}

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

  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch categories");
  }

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
      toast.error(error.message || "Failed to create category");
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
      toast.error(error.message || "Failed to update category");
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
      toast.error(error.message || "Failed to remove category");
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
      toast.error(error.message || "Failed to reorder categories");
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
      toast.error(error.message || "Failed to seed categories");
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
      toast.error(error.message || "Failed to create category group");
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
      toast.error(error.message || "Failed to update category group");
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
      toast.error(error.message || "Failed to archive category group");
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
      toast.error(error.message || "Failed to restore category group");
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
      toast.error(error.message || "Failed to reorder category groups");
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

export interface MerchantAnalytics {
  totalSpent: number;
  transactionCount: number;
  averageTransaction: number;
  trend: Array<{ period: string; total: number; count: number }>;
}

export interface MerchantTransactionsResponse {
  transactions: Array<{
    id: string;
    date: string;
    name: string;
    type: string;
    amount: string;
    isPending: boolean;
    notes?: string | null;
    accountId: string;
  }>;
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
  const response = await fetch("/api/merchants", {
    credentials: "include",
  });

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error(
      "Server returned non-JSON response. Please ensure you are logged in.",
    );
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch merchants");
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
  const response = await fetch(`/api/merchants/autocomplete?${params}`, {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch merchants");
  }

  const result = await response.json();
  return result.data?.merchants || [];
}

async function fetchMerchantDetails(
  id: string,
): Promise<MerchantDetailResponse> {
  const response = await fetch(`/api/merchants/${id}`, {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch merchant details");
  }

  const result = await response.json();
  return result.data;
}

async function fetchMerchantDuplicates(): Promise<MerchantDuplicateGroup[]> {
  const response = await fetch("/api/merchants/duplicates", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch duplicates");
  }

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

async function deleteMerchant(
  id: string,
  options?: { action?: "soft" | "hard" | "merge"; mergeTargetId?: string },
): Promise<{ deletedCount: number; affectedTransactions: number }> {
  const query = new URLSearchParams();
  if (options?.action) query.set("action", options.action);
  if (options?.mergeTargetId) query.set("mergeTargetId", options.mergeTargetId);
  const queryStr = query.toString();
  const result = await apiCall<
    Envelope<{ deletedCount: number; affectedTransactions: number }>
  >(`/merchants/${id}${queryStr ? `?${queryStr}` : ""}`, {
    method: "DELETE",
  });
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

  const response = await fetch(
    `/api/merchants/${id}/analytics${queryStr ? `?${queryStr}` : ""}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error?.message || "Failed to fetch merchant analytics",
    );
  }

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

  const response = await fetch(
    `/api/merchants/${id}/transactions${queryStr ? `?${queryStr}` : ""}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error?.message || "Failed to fetch merchant transactions",
    );
  }

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
  const response = await fetch("/api/merchants/merge/history", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch merge history");
  }

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
      toast.error(error.message || "Failed to create merchant");
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
      toast.error(error.message || "Failed to update merchant");
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
      options?: { action?: "soft" | "hard" | "merge"; mergeTargetId?: string };
    }) => deleteMerchant(id, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      toast.success("Merchant deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete merchant");
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
      toast.error(error.message || "Failed to add alias");
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
      toast.error(error.message || "Failed to remove alias");
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
      toast.error(error.message || "Failed to upload logo");
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
      toast.error(error.message || "Failed to remove logo");
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
      toast.error(error.message || "Failed to merge merchants");
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
      toast.error(error.message || "Failed to undo merge");
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
  amount?: number;
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
  const response = await fetch("/api/rules", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch rules");
  }

  const data = await response.json();
  return data.data.rules;
}

async function createRule(data: CreateRuleData): Promise<Rule> {
  const result = await apiCall<Envelope<{ rule: Rule }>>("/rules", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return result.data.rule;
}

async function updateRule(id: string, data: UpdateRuleData): Promise<Rule> {
  const result = await apiCall<Envelope<{ rule: Rule }>>(`/rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return result.data.rule;
}

async function deleteRule(id: string): Promise<void> {
  await apiCall<Envelope<unknown>>(`/rules/${id}`, { method: "DELETE" });
}

async function testRule(id: string): Promise<{ matchingCount: number }> {
  const result = await apiCall<Envelope<{ matchingCount: number }>>(
    `/rules/${id}/test`,
    { method: "POST" },
  );
  return result.data;
}

async function reorderRules(ruleIds: string[]): Promise<void> {
  await apiCall<Envelope<unknown>>("/rules/reorder", {
    method: "PUT",
    body: JSON.stringify({ ruleIds }),
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

export interface RulePreviewResult {
  matchCount: number;
  transactions: RulePreviewTransaction[];
  totalScanned: number;
}

async function previewRule(data: {
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Rule created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create rule");
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRuleData }) =>
      updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Rule updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update rule");
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
      toast.error(error.message || "Failed to delete rule");
    },
  });
}

export function useTestRule() {
  return useMutation({
    mutationFn: testRule,
    onSuccess: (data) => {
      toast.success(`Rule would match ${data.matchingCount} transactions`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to test rule");
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
      toast.error(error.message || "Failed to reorder rules");
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
      toast.error(error.message || "Failed to seed merchants");
    },
  });
}
// ============================================================================
// USER PREFERENCES
// ============================================================================

export interface UserPreferences {
  userId: string;
  rememberLastAccount: boolean;
  rememberLastCategoryPerMerchant: boolean;
  defaultTransactionType: string;
  autoFillTodayDate: boolean;
  skipDuplicateImports: boolean;
  autoAssignCategoriesFromRules: boolean;
  autoCreateFromReceipt: boolean;
  requireOcrReview: boolean;
  ocrConfidenceThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserPreferencesData {
  rememberLastAccount?: boolean;
  rememberLastCategoryPerMerchant?: boolean;
  defaultTransactionType?: string;
  autoFillTodayDate?: boolean;
  skipDuplicateImports?: boolean;
  autoAssignCategoriesFromRules?: boolean;
  autoCreateFromReceipt?: boolean;
  requireOcrReview?: boolean;
  ocrConfidenceThreshold?: number;
}

async function fetchUserPreferences(): Promise<UserPreferences> {
  const response = await fetch("/api/settings/preferences", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch preferences");
  }

  const data = await response.json();
  return data.data.preferences;
}

async function updateUserPreferences(
  data: UpdateUserPreferencesData,
): Promise<UserPreferences> {
  const result = await apiCall<Envelope<{ preferences: UserPreferences }>>(
    "/settings/preferences",
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data.preferences;
}

export function useUserPreferences() {
  return useQuery({
    queryKey: ["userPreferences"],
    queryFn: fetchUserPreferences,
    retry: false,
  });
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateUserPreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(["userPreferences"], data);
      toast.success("Preferences updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update preferences");
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

export interface UpdateAIConsentResponse {
  consentGiven: boolean;
  consentDate: string;
  consentVersion: string | null;
}

async function fetchAIConsent(): Promise<AIConsentStatus> {
  return apiCall<AIConsentStatus>("/ai/consent");
}

async function updateAIConsent(
  consentGiven: boolean,
): Promise<UpdateAIConsentResponse> {
  return apiCall<UpdateAIConsentResponse>("/ai/consent", {
    method: "POST",
    body: JSON.stringify({ consentGiven }),
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
      toast.error(error.message || "Failed to update AI consent");
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
