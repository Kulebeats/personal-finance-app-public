import { ProtectedImage } from "@/components/session/ProtectedImage";
import {
  Building2,
  Bus,
  Droplet,
  GraduationCap,
  Heart,
  ShoppingCart,
  Smartphone,
  Store,
  Tv,
  Utensils,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type MerchantAvatarSize = "sm" | "md" | "lg";

const CATEGORY_ICON_MAP: Record<
  string,
  { icon: typeof Store; className: string }
> = {
  "Food & Dining": { icon: Utensils, className: "text-orange-600" },
  Transportation: { icon: Bus, className: "text-blue-600" },
  Utilities: { icon: Droplet, className: "text-cyan-600" },
  Telecommunications: { icon: Smartphone, className: "text-violet-600" },
  "Retail & Shopping": { icon: ShoppingCart, className: "text-rose-600" },
  "Banking & Finance": { icon: Building2, className: "text-emerald-600" },
  Healthcare: { icon: Heart, className: "text-red-600" },
  Education: { icon: GraduationCap, className: "text-blue-700" },
  Entertainment: { icon: Tv, className: "text-indigo-600" },
};

const FALLBACK_ICON = { icon: Store, className: "text-rose-500" };

const SIZE_CLASSES: Record<MerchantAvatarSize, string> = {
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

const ICON_SIZE_CLASSES: Record<MerchantAvatarSize, string> = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

const BG_CLASSES: Record<MerchantAvatarSize, string> = {
  sm: "bg-muted",
  md: "bg-rose-100",
  lg: "bg-muted",
};

interface MerchantAvatarProps {
  name: string;
  logoUrl?: string | null;
  category?: string | null;
  size?: MerchantAvatarSize;
  className?: string;
}

const resolveLogoUrl = (logoUrl: string, size: MerchantAvatarSize) => {
  if (!logoUrl) return logoUrl;
  if (size === "lg") return logoUrl;
  if (logoUrl.includes("-512.png")) {
    return logoUrl.replace("-512.png", "-128.png");
  }
  return logoUrl;
};

export function MerchantAvatar({
  name,
  logoUrl,
  category,
  size = "md",
  className,
}: MerchantAvatarProps) {
  const resolvedLogoUrl = useMemo(
    () => (logoUrl ? resolveLogoUrl(logoUrl, size) : null),
    [logoUrl, size]
  );
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [resolvedLogoUrl]);

  if (resolvedLogoUrl && !hasError) {
    return (
      <ProtectedImage
        src={resolvedLogoUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        onError={() => setHasError(true)}
        className={`${
          SIZE_CLASSES[size]
        } rounded bg-card dark:bg-slate-800 object-contain ${className || ""}`}
      />
    );
  }

  const iconConfig = (category && CATEGORY_ICON_MAP[category]) || FALLBACK_ICON;
  const Icon = iconConfig.icon;

  return (
    <div
      className={`${SIZE_CLASSES[size]} ${
        BG_CLASSES[size]
      } flex items-center justify-center rounded ${className || ""}`}
      title={category || "Merchant"}
    >
      <Icon className={`${ICON_SIZE_CLASSES[size]} ${iconConfig.className}`} />
    </div>
  );
}
