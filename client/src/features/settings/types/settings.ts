import type { UseFormReturn } from "react-hook-form";
import type { ProfileFormData } from "../schemas/profileSchema";
import type { SettingsSection } from "../constants/sectionNames";
import type {
  NotificationType,
  NotificationCategory,
} from "../constants/notificationTypes";
import type { MonthOption } from "../constants/months";
import type { RoleOption } from "../constants/roleOptions";
import type {
  ConditionType,
  Operator,
  ActionType,
} from "../constants/ruleConditions";

// Re-export commonly used types
export type {
  SettingsSection,
  NotificationType,
  NotificationCategory,
  MonthOption,
  RoleOption,
};

// Profile types
export interface ProfileData {
  fullName: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  birthday?: Date;
  timezone: string;
  gender?: "male" | "female" | "";
  phoneNumberMobile?: string;
  phoneNumberWork?: string;
  phoneNumberHome?: string;
  occupation?: string;
  address?: AddressData;
  annualIncome?: string;
  incomeFrequency: "monthly" | "bi-weekly" | "annual";
  employmentStatus?:
    | "employed"
    | "self-employed"
    | "retired"
    | "unemployed"
    | "student"
    | "";
  investmentGoal?: "conservative" | "moderate" | "aggressive" | "";
  riskTolerance?: "low" | "medium" | "high" | "";
  salaryRange?: string;
  birthdayHideYear: boolean;
  profilePicture?: string;
  bannerUrl?: string;
}

export interface AddressData {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
}

// Display settings types
export interface DisplaySettings {
  theme: "light" | "dark" | "system";
  currency: string;
  dateFormat: string;
  numberFormat: string;
  language: string;
}

// Notification types
export interface NotificationPreference {
  type: string;
  enabled: boolean;
  threshold?: number;
  channels: NotificationChannel[];
}

export type NotificationChannel = "email" | "push" | "sms";

// Security types
export interface Session {
  id: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  lastActive: Date;
  createdAt: Date;
  isCurrent: boolean;
}

export interface DeviceInfo {
  browser: string;
  os: string;
  device: "desktop" | "mobile" | "tablet";
}

export interface LoginHistoryEntry {
  id: string;
  timestamp: Date;
  ipAddress: string;
  deviceInfo: DeviceInfo;
  success: boolean;
  location?: string;
}

// Household types
export interface Household {
  id: number;
  name: string;
  createdAt: Date;
  ownerId: number;
}

export interface HouseholdMember {
  id: number;
  userId: number;
  householdId: number;
  role: "owner" | "admin" | "member" | "view_only";
  joinedAt: Date;
  user: {
    id: number;
    fullName: string;
    email: string;
    profilePicture?: string;
  };
}

// Category types
export interface Category {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  groupId: string;
  budget?: number;
  spent?: number;
  transactionCount?: number;
  isArchived: boolean;
  displayOrder: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  type: "income" | "expenses" | "transfers";
  budgetMode?: "by_category" | "by_group";
  rolloverEnabled?: boolean;
  isArchived?: boolean;
  categories?: Category[];
}

// Merchant types
export interface Merchant {
  id: number;
  name: string;
  displayName?: string;
  logo?: string;
  defaultCategoryId?: number;
  isHidden: boolean;
  transactionCount: number;
}

// Rule types
export interface Rule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt?: string;
  applyToPast?: boolean;
  lastTriggered?: string;
  triggerCount: number;
  splitConfig?: SplitConfig[];
}

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

export interface RuleAction {
  type: ActionType;
  value?: string | string[];
  enabled?: boolean;
  splitConfig?: SplitConfig[];
}

// Settings card props
export interface SettingsCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  isLoading?: boolean;
  children: React.ReactNode;
}

// Form field props
export interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

// Loading section props
export interface LoadingSectionProps {
  variant?: "card" | "form" | "list";
  rows?: number;
}

// Error boundary props
export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  sectionName?: string;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Additional configuration types
export interface SettingsPageProps {
  defaultSection?: SettingsSection;
}

// Form hook types
export interface UseProfileFormReturn {
  form: UseFormReturn<ProfileFormData>;
  isLoading: boolean;
  isSubmitting: boolean;
  onSubmit: () => Promise<void>;
  isDirty: boolean;
}

// API response types
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Household context type (for middleware)
export interface HouseholdContext {
  householdId: number;
  userId: number;
  role: "owner" | "admin" | "member" | "view_only";
}

// Transaction types (referenced by rules and merchants)
export interface Transaction {
  id: number;
  description: string;
  amount: number;
  date: Date;
  merchantId?: number;
  categoryId?: number;
  accountId: number;
  tags: string[];
  isReviewed: boolean;
}

// Account type (referenced by rules)
export interface Account {
  id: number;
  name: string;
  type: "checking" | "savings" | "credit" | "investment";
  balance: number;
  currency: string;
}

// Settings navigation types
export interface SettingsNavigationItem {
  section: SettingsSection;
  label: string;
  icon: string;
  isActive: boolean;
  hasError?: boolean;
}

// Form validation types
export interface ValidationError {
  field: string;
  message: string;
}

export interface FormState<T = any> {
  data: T;
  errors: ValidationError[];
  isValid: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
}

// Theme types
export type Theme = "light" | "dark" | "system";
export type Currency = "USD" | "EUR" | "GBP" | "ZMW" | "ZAR";
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
export type NumberFormat = "US" | "EU" | "UK";
export type Language = "en" | "fr" | "es" | "de";

// Update DisplaySettings to use the new types
export interface DisplaySettingsUpdated {
  theme: Theme;
  currency: Currency;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  language: Language;
}

// Merge operation types
export interface MerchantMergeOperation {
  primaryMerchantId: number;
  merchantsToMerge: number[];
  newName?: string;
  newDisplayName?: string;
  newDefaultCategoryId?: number;
}
