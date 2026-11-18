import { useState } from "react";
import { cn } from "@/lib/utils";

interface BankLogoProps {
  institution: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

// Institution to logo path mapping
const INSTITUTION_LOGOS: Record<string, string> = {
  // Banks
  "absa bank zambia": "/logos/banks/absa.png",
  "access bank zambia": "/logos/banks/access-bank.png",
  "atlas mara (bancabc)": "/logos/banks/atlas-mara.png",
  "bank of china (zambia)": "/logos/banks/bank-of-china.png",
  "citibank zambia": "/logos/banks/citibank.png",
  "ecobank zambia": "/logos/banks/ecobank.png",
  "first capital bank": "/logos/banks/first-capital.png",
  "first national bank (fnb)": "/logos/banks/fnb.png",
  "indo-zambia bank": "/logos/banks/indo-zambia.png",
  "investrust bank": "/logos/banks/investrust.png",
  "stanbic bank zambia": "/logos/banks/stanbic.png",
  "standard chartered bank": "/logos/banks/standard-chartered.png",
  "united bank for africa (uba)": "/logos/banks/uba.png",
  "zambia national commercial bank (zanaco)": "/logos/banks/zanaco.png",

  // Mobile Money
  "airtel money": "/logos/mobile-money/airtel-money.png",
  "mtn momo": "/logos/mobile-money/mtn-momo.png",
  "zamtel money": "/logos/mobile-money/zamtel-money.png",
};

// Fallback colors for institutions (used when logo fails to load)
const INSTITUTION_COLORS: Record<string, string> = {
  // Banks
  absa: "bg-red-600",
  access: "bg-orange-500",
  atlas: "bg-blue-700",
  "bank of china": "bg-red-700",
  citibank: "bg-blue-600",
  citi: "bg-blue-600",
  ecobank: "bg-blue-500",
  "first capital": "bg-green-600",
  fnb: "bg-cyan-600",
  "first national": "bg-cyan-600",
  "indo-zambia": "bg-purple-600",
  investrust: "bg-green-700",
  stanbic: "bg-blue-800",
  "standard chartered": "bg-green-600",
  stanchart: "bg-green-600",
  uba: "bg-red-600",
  zanaco: "bg-orange-600",

  // Mobile Money
  airtel: "bg-red-500",
  mtn: "bg-yellow-500",
  zamtel: "bg-green-500",
};

const SIZE_CLASSES = {
  sm: "w-5 h-5 text-[10px]", // 20x20 for dropdowns
  md: "w-8 h-8 text-xs", // 32x32 for lists
  lg: "w-10 h-10 text-sm", // 40x40 for detail views
};

function getLogoPath(institution: string): string | null {
  const normalized = institution.toLowerCase().trim();
  return INSTITUTION_LOGOS[normalized] || null;
}

function getFallbackColor(institution: string): string {
  const normalized = institution.toLowerCase().trim();

  for (const [key, color] of Object.entries(INSTITUTION_COLORS)) {
    if (normalized.includes(key)) {
      return color;
    }
  }

  return "bg-slate-600";
}

function getInitial(institution: string): string {
  return institution.charAt(0).toUpperCase();
}

export function BankLogo({
  institution,
  size = "md",
  className,
}: BankLogoProps) {
  const [imageError, setImageError] = useState(false);
  const logoPath = getLogoPath(institution);
  const sizeClass = SIZE_CLASSES[size];

  // Show logo if available and not errored
  if (logoPath && !imageError) {
    return (
      <img
        src={logoPath}
        alt={institution}
        className={cn(sizeClass, "rounded-full object-contain", className)}
        onError={() => setImageError(true)}
      />
    );
  }

  // Fallback: Colored circle with initial
  const initial = getInitial(institution);
  const bgColor = getFallbackColor(institution);

  return (
    <div
      className={cn(
        sizeClass,
        "rounded-full flex items-center justify-center text-white font-bold shrink-0",
        bgColor,
        className
      )}
    >
      {initial}
    </div>
  );
}
