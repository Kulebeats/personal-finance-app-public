import React from "react";
import { Label } from "@/components/ui/label";
import {
  formatPhonePreview,
  isValidZambianNumber,
} from "@/utils/profileHelpers";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { cn } from "@/lib/utils";

interface PhoneNumberInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  id?: string;
}

export function PhoneNumberInput({
  label,
  value,
  onChange,
  placeholder = "Enter phone number",
  required = false,
  className,
  id,
}: PhoneNumberInputProps) {
  const handleChange = (newValue: string | undefined) => {
    onChange(newValue || "");
  };

  const isValid = value ? isValidZambianNumber(value) : null;
  const preview = value ? formatPhonePreview(value) : null;

  // Check if it's a Zambian number that doesn't start with 09
  const isZambianButNotMobile =
    value &&
    value.startsWith("+260") &&
    !value.startsWith("+2609") &&
    value.length > 4;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={id}
        className="text-xs font-semibold text-muted-foreground uppercase"
      >
        {label} {required && "*"}
      </Label>

      <div className="relative">
        <PhoneInput
          international
          defaultCountry="ZM"
          value={value}
          onChange={handleChange}
          className={cn("phone-input", isValid === false && "border-red-300")}
          placeholder={placeholder}
          id={id}
        />
      </div>

      {/* Format Preview and Validation */}
      {value && (
        <div className="space-y-1">
          {preview && (
            <p className="text-xs text-muted-foreground">Preview: {preview}</p>
          )}

          {isValid === true && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              ✓ Valid Zambian number
            </p>
          )}

          {isValid === false && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              ⚠ Invalid format
            </p>
          )}

          {/* Hint for Zambian numbers not starting with 09 */}
          {isZambianButNotMobile && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              💡 Most Zambian mobile numbers start with 09...
            </p>
          )}

          {/* Zambian number hints */}
          {value.startsWith("+260") && (
            <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 p-2 rounded border border-blue-200 dark:border-blue-800">
              <p className="font-medium">Zambian Number Format:</p>
              <ul className="mt-1 space-y-0.5 text-blue-700 dark:text-blue-300">
                <li>• Mobile: +260 9X XXX XXXX (Airtel, MTN, Zamtel)</li>
                <li>• Landline: +260 21X XXX XXX (Lusaka area)</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Custom styles for the phone input
export const phoneInputStyles = `
  .phone-input .PhoneInputInput {
    @apply bg-background dark:bg-slate-800 border border-input rounded-md px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50;
  }
  
  .phone-input .PhoneInputCountrySelect {
    @apply border-r border-input mr-2 pr-2;
  }
  
  .phone-input .PhoneInputCountrySelectArrow {
    @apply text-muted-foreground;
  }
  
  .phone-input .PhoneInputCountryIcon {
    @apply w-5 h-5;
  }
`;
