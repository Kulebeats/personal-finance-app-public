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

// After +260: mobile 95-98 or 75-77 (Zamtel, MTN, Airtel, Zed Mobile — the
// same prefixes getZambianMobileProvider recognises), or a 21x landline.
const ZAMBIAN_NATIONAL_NUMBER = /^(9[5-8]|7[5-7]|21)\d{7}$/;

export function isValidZambianNumber(phone: string): boolean {
  const clean = phone.replace(/[^0-9]/g, "");
  if (!clean.startsWith("260") || clean.length !== 12) return false;
  return ZAMBIAN_NATIONAL_NUMBER.test(clean.slice(3));
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
