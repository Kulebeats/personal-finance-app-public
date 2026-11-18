import { UserProfile } from "@/hooks/use-settings";

interface ProfileField {
  name: string;
  weight: number;
  filled: boolean;
}

export function calculateProfileCompleteness(
  profile: UserProfile | undefined
): {
  percentage: number;
  missing: string[];
  suggestions: string[];
} {
  if (!profile) {
    return { percentage: 0, missing: [], suggestions: [] };
  }

  const fields: ProfileField[] = [
    // Core identity (required)
    { name: "fullName", weight: 10, filled: !!profile.fullName },
    { name: "birthday", weight: 8, filled: !!profile.birthday },
    {
      name: "phoneNumber",
      weight: 9,
      filled: !!profile.phoneNumberMobile || !!profile.phoneNumber,
    },
    { name: "occupation", weight: 7, filled: !!profile.occupation },
    { name: "city", weight: 6, filled: !!profile.address?.city },
    { name: "timezone", weight: 5, filled: !!profile.timezone },
    { name: "gender", weight: 3, filled: !!profile.gender },
    { name: "salaryRange", weight: 6, filled: !!profile.salaryRangeEncrypted },

    // Phase 2: Rich profile fields
    { name: "profilePicture", weight: 8, filled: !!profile.profilePictureUrl },
    { name: "bio", weight: 5, filled: !!profile.bio },
    { name: "bannerPhoto", weight: 3, filled: !!profile.bannerUrl },
    {
      name: "socialLinks",
      weight: 4,
      filled: !!(
        profile.socialLinks?.linkedin ||
        profile.socialLinks?.twitter ||
        profile.socialLinks?.github ||
        profile.socialLinks?.website
      ),
    },
  ];

  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  const filledWeight = fields
    .filter((f) => f.filled)
    .reduce((sum, f) => sum + f.weight, 0);
  const percentage = Math.round((filledWeight / totalWeight) * 100);

  const missing = fields.filter((f) => !f.filled).map((f) => f.name);
  const suggestions = generateSuggestions(missing);

  return { percentage, missing, suggestions };
}

function generateSuggestions(missing: string[]): string[] {
  const suggestionMap: Record<string, string> = {
    occupation: "Add your occupation to get better financial insights",
    salaryRange: "Add salary range for personalized budget recommendations",
    phoneNumber: "Add your phone number to enable notifications",
    city: "Add your city to see local financial trends",
    birthday: "Add your birthday for age-based insights",
    timezone: "Set your timezone for accurate time tracking",
    profilePicture: "Add a profile picture to personalize your account",
    bio: "Write a short bio to tell others about yourself",
    bannerPhoto: "Add a cover photo to make your profile stand out",
    socialLinks: "Connect your social profiles (LinkedIn, Twitter, etc.)",
  };

  return missing
    .filter((field) => suggestionMap[field])
    .slice(0, 2) // Show max 2 suggestions
    .map((field) => suggestionMap[field]);
}

export function getProgressColor(percentage: number): string {
  if (percentage < 50) return "bg-red-500";
  if (percentage < 80) return "bg-yellow-500";
  return "bg-green-500";
}

export function calculateAge(birthday: string | Date): number {
  const birthDate =
    typeof birthday === "string" ? new Date(birthday) : birthday;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return age;
}

export function formatPhonePreview(phone: string): string {
  if (!phone) return "";

  // For Zambian numbers: +260971234567 → "097 123 4567"
  if (phone.startsWith("+260")) {
    const local = phone.slice(4);
    if (local.length >= 9) {
      return `0${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
    }
  }

  return phone;
}

export function isValidZambianNumber(phone: string): boolean {
  const clean = phone.replace(/[^0-9]/g, "");
  if (!clean.startsWith("260")) return false;
  if (clean.length !== 12) return false;
  return clean.startsWith("2609") || clean.startsWith("26021");
}

export function getZambianMobileProvider(
  phone: string | null | undefined
): "MTN" | "Airtel" | "Zamtel" | "Zed Mobile" | null {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, "");

  // Normalize to 09X... format for checking
  let check = clean;
  if (clean.startsWith("260")) check = "0" + clean.slice(3);

  if (check.startsWith("096") || check.startsWith("076")) return "MTN";
  if (check.startsWith("097") || check.startsWith("077")) return "Airtel";
  if (check.startsWith("095") || check.startsWith("075")) return "Zamtel";
  if (check.startsWith("098")) return "Zed Mobile";

  return null;
}

export function getProviderColor(provider: string): string {
  switch (provider) {
    case "MTN":
      return "bg-yellow-400 text-black";
    case "Airtel":
      return "bg-red-500 text-white";
    case "Zamtel":
      return "bg-green-600 text-white";
    case "Zed Mobile":
      return "bg-purple-600 text-white";
    default:
      return "bg-gray-200 text-gray-700";
  }
}
