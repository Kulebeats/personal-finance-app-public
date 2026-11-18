import React, { useState } from "react";
import { cn } from "@/lib/utils";

export type NetworkProvider = "MTN" | "Airtel" | "Zamtel" | "Zed Mobile" | null;

interface NetworkLogoProps {
  provider: NetworkProvider;
  className?: string;
}

// Logo mappings
const LOGO_URLS: Record<string, string> = {
  // Use public assets for the ones we have
  Zamtel: "/logos/zamtel.png",
  "Zed Mobile": "/logos/zed_mobile.png",
  Airtel: "/logos/airtel.png",
  // External URLs for others (with fallback to CSS)
  MTN: "https://upload.wikimedia.org/wikipedia/commons/9/93/New-mtn-logo.jpg",
};

export function NetworkLogo({ provider, className }: NetworkLogoProps) {
  const [error, setError] = useState(false);

  if (!provider) return null;

  const logoUrl = LOGO_URLS[provider];
  const showImage = logoUrl && !error;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center w-8 h-8 rounded-full overflow-hidden border border-border bg-card shadow-sm transition-transform hover:scale-105",
        className,
      )}
      title={`${provider} Network`}
    >
      {showImage ? (
        <img
          src={logoUrl}
          alt={provider}
          className={cn(
            "w-full h-full object-cover",
            // Specific scaling for logos to fit better in circle
            provider === "Airtel" && "scale-110",
            provider === "Zamtel" && "scale-100",
            provider === "Zed Mobile" && "scale-110",
          )}
          onError={() => setError(true)}
        />
      ) : (
        // Fallback CSS Badges
        <div
          className={cn(
            "w-full h-full flex items-center justify-center text-[10px] font-bold text-white",
            provider === "MTN" && "bg-yellow-500 text-black",
            provider === "Airtel" && "bg-red-600",
            provider === "Zamtel" && "bg-green-600",
            provider === "Zed Mobile" && "bg-purple-700",
          )}
        >
          {provider[0]}
        </div>
      )}
    </div>
  );
}
