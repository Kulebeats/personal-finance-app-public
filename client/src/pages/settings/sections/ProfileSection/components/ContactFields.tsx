import React, { useState } from "react";
import { UseFormReturn, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/features/settings/components/FormField";
import { CountrySelector } from "@/components/CountrySelector";
import {
  Smartphone,
  Home,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  getZambianMobileProvider,
  isValidZambianNumber,
} from "@/utils/profileHelpers";
import { cn } from "@/lib/utils";
import { NetworkLogo } from "./NetworkLogo";
import { AddressFields } from "./AddressFields";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";

interface ContactFieldsProps {
  form: UseFormReturn<ProfileFormData>;
}

export function ContactFields({ form }: ContactFieldsProps) {
  const {
    control,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const [showHomePhone, setShowHomePhone] = useState(
    !!watch("phoneNumberHome")
  );

  // Country codes for each field
  const [mobileCountry, setMobileCountry] = useState("ZM");
  const [altMobileCountry, setAltMobileCountry] = useState("ZM");
  const [homeCountry, setHomeCountry] = useState("ZM");

  // Helper to get full phone number with country code
  const getFullPhoneNumber = (
    input: string,
    countryCode: string = "ZM"
  ): string => {
    if (!input) return "";
    // If already has +, return as is
    if (input.startsWith("+")) return input;

    // Check if input starts with 0 (for local format e.g. 097...)
    if (input.startsWith("0")) {
      return countryCode === "ZM" ? `+260${input.substring(1)}` : input;
    }

    // Otherwise prepend country dial code (currently only ZM supported)
    return countryCode === "ZM" ? `+260${input}` : input;
  };

  const mobile = watch("phoneNumberMobile") ?? "";
  const fullMobile = getFullPhoneNumber(mobile, mobileCountry);
  const provider = getZambianMobileProvider(fullMobile);
  const isMobileValid = mobile ? isValidZambianNumber(fullMobile) : null;

  const altMobile = watch("phoneNumberWork") ?? "";
  const fullAltMobile = getFullPhoneNumber(altMobile, altMobileCountry);
  const altProvider = getZambianMobileProvider(fullAltMobile);
  const isAltMobileValid = altMobile
    ? isValidZambianNumber(fullAltMobile)
    : null;

  return (
    <div className="space-y-8 animate-in fade-in-50">
      {/* Phone Numbers Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground border-b border-white/20 pb-2">
          Contact Numbers
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mobile Phone - Permanent */}
          <Controller
            name="phoneNumberMobile"
            control={control}
            render={({ field }) => (
              <FormField
                label="Mobile Phone"
                htmlFor="phoneNumberMobile"
                error={errors.phoneNumberMobile?.message as string}
                className="relative"
              >
                <div className="flex gap-2">
                  <CountrySelector
                    value={mobileCountry}
                    onChange={setMobileCountry}
                    className="w-40 shrink-0"
                  />
                  <div className="relative flex-1 group transition-all duration-200 focus-within:scale-[1.01]">
                    <Smartphone className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                    <Input
                      {...field}
                      value={field.value || ""}
                      id="phoneNumberMobile"
                      placeholder="97 123 4567"
                      className={cn(
                        "pl-10 input-glass transition-all shadow-sm focus:shadow-md",
                        isMobileValid === true &&
                          "border-green-500/50 focus:border-green-500",
                        isMobileValid === false &&
                          field.value &&
                          "border-red-500/50 focus:border-red-500"
                      )}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9+ ]/g, "");
                        field.onChange(val);
                      }}
                    />
                  </div>
                </div>

                {/* Provider Badge Below Input */}
                {provider && (
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <span className="text-[10px] text-muted-foreground">
                      Detected:
                    </span>
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 border border-border">
                      <NetworkLogo provider={provider} className="w-4 h-4" />
                      <span className="text-[10px] font-medium text-foreground">
                        {provider}
                      </span>
                    </div>
                  </div>
                )}

                {/* Validation Hint */}
                {field.value && isMobileValid === false && (
                  <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Invalid number format for selected country
                  </p>
                )}
              </FormField>
            )}
          />

          {/* Alternative Mobile Number (was "Work Phone") */}
          <Controller
            name="phoneNumberWork"
            control={control}
            render={({ field }) => (
              <FormField
                label="Alternative Mobile Number"
                htmlFor="phoneNumberWork"
                error={errors.phoneNumberWork?.message as string}
                className="relative"
              >
                <div className="flex gap-2">
                  <CountrySelector
                    value={altMobileCountry}
                    onChange={setAltMobileCountry}
                    className="w-40 shrink-0"
                  />
                  <div className="relative flex-1 group transition-all duration-200 focus-within:scale-[1.01]">
                    <Smartphone className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                    <Input
                      {...field}
                      value={field.value || ""}
                      id="phoneNumberWork"
                      placeholder="97 123 4567"
                      className={cn(
                        "pl-10 input-glass transition-all shadow-sm focus:shadow-md",
                        isAltMobileValid === true &&
                          "border-green-500/50 focus:border-green-500",
                        isAltMobileValid === false &&
                          field.value &&
                          "border-red-500/50 focus:border-red-500"
                      )}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9+ ]/g, "");
                        field.onChange(val);
                      }}
                    />
                  </div>
                </div>

                {/* Provider Badge Below Input */}
                {altProvider && (
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <span className="text-[10px] text-muted-foreground">
                      Detected:
                    </span>
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 border border-border">
                      <NetworkLogo provider={altProvider} className="w-4 h-4" />
                      <span className="text-[10px] font-medium text-foreground">
                        {altProvider}
                      </span>
                    </div>
                  </div>
                )}

                {/* Validation Hint */}
                {field.value && isAltMobileValid === false && (
                  <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Invalid number format for selected country
                  </p>
                )}
              </FormField>
            )}
          />
        </div>

        {/* Optional Home Phone */}
        {showHomePhone && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-200">
            <Controller
              name="phoneNumberHome"
              control={control}
              render={({ field }) => (
                <FormField label="Home Phone" htmlFor="phoneNumberHome">
                  <div className="flex gap-2">
                    <CountrySelector
                      value={homeCountry}
                      onChange={setHomeCountry}
                      className="w-40 shrink-0"
                    />
                    <div className="relative flex-1 group transition-all duration-200 focus-within:scale-[1.01]">
                      <Home className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground group-focus-within:text-blue-400 transition-colors pointer-events-none" />
                      <Input
                        {...field}
                        value={field.value || ""}
                        id="phoneNumberHome"
                        placeholder="Home number"
                        className="pl-10 input-glass shadow-sm focus:shadow-md transition-all"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                        onClick={() => {
                          setValue("phoneNumberHome", "");
                          setShowHomePhone(false);
                        }}
                        aria-label="Remove home phone"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </FormField>
              )}
            />
          </div>
        )}

        {/* Add Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            {!showHomePhone && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground -ml-2 h-8"
                onClick={() => setShowHomePhone(true)}
              >
                <Plus className="w-3 h-3 mr-1.5" />
                Add Home Phone
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Address Section */}
      <AddressFields />
    </div>
  );
}
