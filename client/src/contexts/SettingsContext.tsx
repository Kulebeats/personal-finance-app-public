import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useDisplaySettings } from "@/hooks/use-settings";

interface SettingsContextType {
  theme: string;
  currency: string;
  timezone: string;
  numberFormat: string;
  dateFormat: string;
  firstDayOfWeek: string;
  viewMode: string;
  isLoading: boolean;
  sidebarCollapsed: boolean;
  animationsEnabled: boolean;
  toggleSidebar: () => void;
  toggleAnimations: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data: settings, isLoading } = useDisplaySettings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const toggleAnimations = () => setAnimationsEnabled((prev) => !prev);

  // Apply theme to document
  useEffect(() => {
    if (!settings) return;

    const root = document.documentElement;

    if (settings.theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light-gray");
    } else if (settings.theme === "light-gray") {
      root.classList.add("light-gray");
      root.classList.remove("dark");
    } else if (settings.theme === "light") {
      root.classList.remove("dark", "light-gray");
    } else {
      // System theme
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      if (prefersDark) {
        root.classList.add("dark");
        root.classList.remove("light-gray");
      } else {
        root.classList.remove("dark", "light-gray");
      }
    }
  }, [settings?.theme]);

  const value: SettingsContextType = {
    theme: settings?.theme || "light-gray",
    currency: settings?.currency || "ZMW",
    timezone: settings?.timezone || "Africa/Lusaka",
    numberFormat: settings?.numberFormat || "US",
    dateFormat: settings?.dateFormat || "MM/DD/YYYY",
    firstDayOfWeek: settings?.firstDayOfWeek || "Sunday",
    viewMode: settings?.viewMode || "comfortable",
    isLoading,
    sidebarCollapsed,
    animationsEnabled,
    toggleSidebar,
    toggleAnimations,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

// Import format utilities
import {
  formatCurrency as formatCurrencyUtil,
  formatDate as formatDateUtil,
  formatDateTime as formatDateTimeUtil,
  parseNumber as parseNumberUtil,
} from "@/lib/format";

// Re-export format utilities for convenience
export {
  formatCurrency,
  formatDate,
  formatDateTime,
  parseNumber,
} from "@/lib/format";

/**
 * Hook that provides formatting functions pre-configured with user settings
 */
export function useFormatters() {
  const settings = useSettings();

  return {
    /**
     * Format a number as currency using user's currency and number format settings
     */
    formatCurrency: (amount: number) => {
      return formatCurrencyUtil(
        amount,
        settings.currency,
        settings.numberFormat,
      );
    },

    /**
     * Format a date using user's date format setting
     */
    formatDate: (date: Date | string) => {
      return formatDateUtil(date, settings.dateFormat);
    },

    /**
     * Format a date and time using user's date format setting
     */
    formatDateTime: (date: Date | string) => {
      return formatDateTimeUtil(date, settings.dateFormat);
    },

    /**
     * Parse a number string using user's number format setting
     */
    parseNumber: (value: string) => {
      return parseNumberUtil(value, settings.numberFormat);
    },

    // Raw settings for direct access
    currency: settings.currency,
    timezone: settings.timezone,
    numberFormat: settings.numberFormat,
    dateFormat: settings.dateFormat,
  };
}
