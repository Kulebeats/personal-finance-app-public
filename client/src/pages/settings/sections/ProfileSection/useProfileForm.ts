import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useCallback } from "react";
import {
  profileSchema,
  type ProfileFormData,
  defaultProfileData,
} from "@/features/settings/schemas/profileSchema";
import { useProfile, useUpdateProfile } from "@/hooks/use-settings";

export interface UseProfileFormReturn {
  form: ReturnType<typeof useForm<ProfileFormData>>;
  isLoading: boolean;
  isSubmitting: boolean;
  onSubmit: () => Promise<boolean>;
  isDirty: boolean;
  saveProfile: (data: ProfileFormData) => Promise<void>;
}

/**
 * useProfileForm - Custom hook for profile form management
 *
 * Integrates React Hook Form with Zod resolver for validation.
 * Handles form initialization with API data and auto-save functionality.
 *
 * Features:
 * - Zod schema validation
 * - Form initialization from API data using reset method
 * - Dirty state tracking
 * - Optimized field-level re-rendering
 */
export function useProfileForm(): UseProfileFormReturn {
  const { data: profileData, isLoading: isProfileLoading } = useProfile();
  const updateProfile = useUpdateProfile();

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaultProfileData as ProfileFormData,
    mode: "onBlur", // Validate on blur for better UX
  });

  // Initialize form with API data when loaded
  useEffect(() => {
    if (profileData && !isProfileLoading) {
      // Transform API data to form data format
      const formData = transformApiToFormData(profileData);
      form.reset(formData, { keepDirty: false });
    }
  }, [profileData, isProfileLoading]); // Removed 'form' from dependencies to prevent unnecessary resets

  const saveProfile = useCallback(
    async (data: ProfileFormData) => {
      // Transform form data to API format (creates a new object)
      const apiData = transformFormToApiData(data);
      await updateProfile.mutateAsync(apiData);
    },
    [updateProfile]
  );

  const onSubmit = useCallback(async () => {
    const isValid = await form.trigger();
    if (isValid) {
      const data = form.getValues();
      await saveProfile(data);
      return true;
    }
    return false;
  }, [form, saveProfile]);

  return {
    form,
    isLoading: isProfileLoading,
    isSubmitting: updateProfile.isPending,
    onSubmit,
    isDirty: form.formState.isDirty,
    saveProfile,
  };
}

/**
 * Helper: Strip +260 country code from phone number for display
 */
function stripCountryCode(phone: string | undefined): string {
  if (!phone) return "";
  // If starts with +260, remove it to show just the 9 digits
  if (phone.startsWith("+260")) {
    return phone.substring(4); // Remove "+260"
  }
  return phone;
}

/**
 * Helper: Add +260 country code to phone number for storage
 */
function addCountryCode(phone: string | undefined): string | null {
  if (!phone) return null;
  // If already has +, return as is
  if (phone.startsWith("+")) return phone;
  // If it's 9 digits, add +260
  if (/^[0-9]{9}$/.test(phone)) {
    return `+260${phone}`;
  }
  // If it's 10 digits and starts with 0, remove 0 and add +260
  if (/^0[0-9]{9}$/.test(phone)) {
    return `+260${phone.substring(1)}`;
  }
  // Otherwise return as is (will fail validation)
  return phone;
}

/**
 * Helper: Convert country name to ISO 3166-1 alpha-2 code
 * For backward compatibility with existing data
 */
function convertCountryToCode(country: string): string {
  // If already a 2-letter code, return it
  if (country.length === 2) {
    return country.toUpperCase();
  }

  // Map common country names to codes
  const nameToCode: Record<string, string> = {
    Zambia: "ZM",
    "United States": "US",
    "United Kingdom": "GB",
    Canada: "CA",
    Australia: "AU",
    India: "IN",
    "South Africa": "ZA",
    Kenya: "KE",
    Nigeria: "NG",
    Germany: "DE",
    France: "FR",
  };

  return nameToCode[country] || "ZM"; // Default to Zambia
}

/**
 * Address shape as returned by the profile API, including legacy field names
 * (`street`, `zip`) retained for backward compatibility with older records.
 */
interface RawProfileAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /** @deprecated legacy field, mapped to addressLine1 */
  street?: string;
  /** @deprecated legacy field, mapped to postalCode */
  zip?: string;
}

/**
 * Raw profile payload consumed by the profile form. Models the canonical
 * profile fields plus a few legacy/transitional fields the transform still
 * reads defensively (`salaryRange`, `profilePicture`, and address
 * `street`/`zip`). Every field is optional because the transform supplies its
 * own defaults, and values may be `null` since they originate from nullable DB
 * columns.
 */
export interface RawProfileApiResponse {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  birthday?: string | null;
  birthdayHideYear?: boolean | null;
  timezone?: string | null;
  gender?: string | null;
  phoneNumberMobile?: string | null;
  phoneNumberWork?: string | null;
  phoneNumberHome?: string | null;
  occupation?: string | null;
  bio?: string | null;
  nrc?: string | null;
  socialLinks?: ProfileFormData["socialLinks"] | null;
  bannerUrl?: string | null;
  address?: RawProfileAddress | null;
  annualIncome?: string | null;
  incomeFrequency?: string | null;
  employmentStatus?: string | null;
  investmentGoal?: string | null;
  riskTolerance?: string | null;
  profilePictureUrl?: string | null;
  /** @deprecated legacy field not present on the canonical profile */
  salaryRange?: string | null;
  /** @deprecated legacy field, superseded by profilePictureUrl */
  profilePicture?: string | null;
}

/**
 * Transform API response data to form data format
 */
export function transformApiToFormData(
  apiData: RawProfileApiResponse
): ProfileFormData {
  return {
    fullName: apiData.fullName || "",
    firstName: apiData.firstName || "",
    lastName: apiData.lastName || "",
    displayName: apiData.displayName || undefined,
    birthday: apiData.birthday ? new Date(apiData.birthday) : null,
    birthdayHideYear: apiData.birthdayHideYear ?? false,
    timezone: apiData.timezone || "Africa/Lusaka",
    gender:
      (apiData.gender as ProfileFormData["gender"]) ||
      (undefined as unknown as ProfileFormData["gender"]),
    phoneNumberMobile: stripCountryCode(apiData.phoneNumberMobile ?? undefined),
    phoneNumberWork: stripCountryCode(apiData.phoneNumberWork ?? undefined),
    phoneNumberHome: apiData.phoneNumberHome || undefined,
    occupation: apiData.occupation || undefined,
    bio: apiData.bio || "",
    nrc: apiData.nrc || "",
    socialLinks: apiData.socialLinks || {
      linkedin: "",
      facebook: "",
      twitter: "",
      github: "",
      email: "",
      website: "",
    },
    bannerUrl: apiData.bannerUrl || undefined,
    address: apiData.address
      ? {
          // Map legacy 'street' to 'addressLine1', or use new 'addressLine1'
          addressLine1:
            apiData.address.addressLine1 || apiData.address.street || "",
          addressLine2: apiData.address.addressLine2 || "",
          city: apiData.address.city || "",
          state: apiData.address.state || "",
          // Map legacy 'zip' to 'postalCode', or use new 'postalCode'
          postalCode: apiData.address.postalCode || apiData.address.zip || "",
          // Convert "Zambia" to "ZM", or use an existing ISO code
          country: convertCountryToCode(apiData.address.country || "Zambia"),
        }
      : { addressLine1: "", city: "", country: "ZM" },
    annualIncome: apiData.annualIncome || undefined,
    incomeFrequency:
      (apiData.incomeFrequency as ProfileFormData["incomeFrequency"]) ||
      "monthly",
    employmentStatus:
      (apiData.employmentStatus as ProfileFormData["employmentStatus"]) ||
      undefined,
    investmentGoal:
      (apiData.investmentGoal as ProfileFormData["investmentGoal"]) ||
      undefined,
    riskTolerance:
      (apiData.riskTolerance as ProfileFormData["riskTolerance"]) || undefined,
    salaryRange: apiData.salaryRange || undefined,
    profilePicture:
      apiData.profilePictureUrl || apiData.profilePicture || undefined,
  };
}

/**
 * Transform form data to API request format
 */
export function transformFormToApiData(
  formData: ProfileFormData
): Record<string, unknown> {
  return {
    ...formData,
    // Convert Date to ISO string for API
    birthday: formData.birthday ? formData.birthday.toISOString() : null,
    // Ensure empty strings are converted to null for optional fields
    // Add +260 prefix if user entered only 9 digits
    phoneNumberMobile: addCountryCode(formData.phoneNumberMobile),
    phoneNumberWork: addCountryCode(formData.phoneNumberWork),
    phoneNumberHome: formData.phoneNumberHome || null,
    profilePicture: formData.profilePicture || null,
    profilePictureUrl: formData.profilePicture || null,
  };
}
