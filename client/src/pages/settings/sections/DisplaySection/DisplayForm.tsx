import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  displaySchema,
  DisplayFormData,
} from "@/features/settings/schemas/displaySchema";
import { useDisplaySettings, useUpdateDisplaySettings } from "@/hooks/use-settings";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { FormField } from "@/features/settings/components/FormField";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import React, { useEffect } from "react";
import { TIMEZONES } from "@/data/timezones";
import { toast } from "sonner";
import { notifyInvalidSubmit } from "@/lib/forms/notifyInvalidSubmit";

export function DisplayForm() {
  const { data: displaySettings, isLoading } = useDisplaySettings();
  const updateDisplaySettings = useUpdateDisplaySettings();

  const form = useForm<DisplayFormData>({
    resolver: zodResolver(displaySchema),
    defaultValues: {
      theme: "light-gray",
      currency: "ZMW",
      currencyPosition: "before",
      locale: "en-US",
      timezone: "Africa/Lusaka",
      numberFormat: "US",
      dateFormat: "MM/DD/YYYY",
      firstDayOfWeek: "Sunday",
      viewMode: "comfortable",
    },
  });

  const { reset } = form;

  // Populate form when data loads
  useEffect(() => {
    if (displaySettings) {
      reset({
        theme:
          (displaySettings.theme as
            | "light"
            | "dark"
            | "light-gray"
            | "system") || "light-gray",
        currency: displaySettings.currency || "ZMW",
        currencyPosition:
          (displaySettings.currencyPosition as "before" | "after") || "before",
        locale: displaySettings.locale || "en-US",
        timezone: displaySettings.timezone || "Africa/Lusaka",
        numberFormat: (displaySettings.numberFormat as "US" | "EU") || "US",
        dateFormat:
          (displaySettings.dateFormat as
            | "MM/DD/YYYY"
            | "DD/MM/YYYY"
            | "YYYY-MM-DD") || "MM/DD/YYYY",
        firstDayOfWeek:
          (displaySettings.firstDayOfWeek as "Sunday" | "Monday") || "Sunday",
        viewMode:
          (displaySettings.viewMode as "comfortable" | "compact") ||
          "comfortable",
      });
    }
  }, [displaySettings, reset]);

  const onSubmit = (data: DisplayFormData) => {
    updateDisplaySettings.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SettingsCard
      title="Display Settings"
      description="Customize how information is displayed in the app"
    >
      <form onSubmit={form.handleSubmit(onSubmit, notifyInvalidSubmit())} className="space-y-6">
        <div className="space-y-4 max-w-xl">
          {/* Theme */}
          <Controller
            name="theme"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Theme"
                error={form.formState.errors.theme?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select theme preference"
                  >
                    <SelectValue placeholder="Select theme..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light (Pure White)</SelectItem>
                    <SelectItem value="light-gray">
                      Light Gray (Soft)
                    </SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">
                      System (follows OS preference)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Currency */}
          <Controller
            name="currency"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Currency"
                error={form.formState.errors.currency?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select currency"
                  >
                    <SelectValue placeholder="Select currency..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ZMW">ZMW - Zambian Kwacha</SelectItem>
                    <SelectItem value="USD">USD - US Dollar</SelectItem>
                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                    <SelectItem value="GBP">GBP - British Pound</SelectItem>
                    <SelectItem value="ZAR">
                      ZAR - South African Rand
                    </SelectItem>
                    <SelectItem value="KES">KES - Kenyan Shilling</SelectItem>
                    <SelectItem value="NGN">NGN - Nigerian Naira</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Currency Position */}
          <Controller
            name="currencyPosition"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Currency Position"
                error={form.formState.errors.currencyPosition?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select currency position"
                  >
                    <SelectValue placeholder="Select position..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before">Before amount ($100)</SelectItem>
                    <SelectItem value="after">After amount (100$)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Locale */}
          <Controller
            name="locale"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Language / Locale"
                error={form.formState.errors.locale?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select language and locale"
                  >
                    <SelectValue placeholder="Select locale..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en-US">English (US)</SelectItem>
                    <SelectItem value="en-GB">English (UK)</SelectItem>
                    <SelectItem value="fr-FR">French (France)</SelectItem>
                    <SelectItem value="es-ES">Spanish (Spain)</SelectItem>
                    <SelectItem value="de-DE">German (Germany)</SelectItem>
                    <SelectItem value="pt-PT">Portuguese (Portugal)</SelectItem>
                    <SelectItem value="zh-CN">Chinese (Simplified)</SelectItem>
                    <SelectItem value="ja-JP">Japanese</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Display Timezone */}
          <Controller
            name="timezone"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Display Timezone"
                error={form.formState.errors.timezone?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select display timezone"
                  >
                    <SelectValue placeholder="Select timezone..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Number Format */}
          <Controller
            name="numberFormat"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Number Format"
                error={form.formState.errors.numberFormat?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select number format"
                  >
                    <SelectValue placeholder="Select format..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">1,000.00 (US style)</SelectItem>
                    <SelectItem value="EU">
                      1.000,00 (European style)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Date Format */}
          <Controller
            name="dateFormat"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="Date Format"
                error={form.formState.errors.dateFormat?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select date format"
                  >
                    <SelectValue placeholder="Select format..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MM/DD/YYYY">
                      MM/DD/YYYY (12/31/2025)
                    </SelectItem>
                    <SelectItem value="DD/MM/YYYY">
                      DD/MM/YYYY (31/12/2025)
                    </SelectItem>
                    <SelectItem value="YYYY-MM-DD">
                      YYYY-MM-DD (2025-12-31)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* First Day of Week */}
          <Controller
            name="firstDayOfWeek"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="First Day of Week"
                error={form.formState.errors.firstDayOfWeek?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select first day of week"
                  >
                    <SelectValue placeholder="Select day..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sunday">Sunday</SelectItem>
                    <SelectItem value="Monday">Monday</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* View Mode */}
          <Controller
            name="viewMode"
            control={form.control}
            render={({ field }) => (
              <FormField
                label="View Mode"
                error={form.formState.errors.viewMode?.message}
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="bg-card dark:bg-slate-800"
                    aria-label="Select view mode"
                  >
                    <SelectValue placeholder="Select mode..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comfortable">
                      Comfortable (more spacing)
                    </SelectItem>
                    <SelectItem value="compact">
                      Compact (denser layout)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        </div>

        <div className="pt-4">
          <Button
            type="submit"
            className="w-full bg-rose-400 hover:bg-rose-500 text-white font-medium h-10"
            disabled={updateDisplaySettings.isPending}
            aria-label="Save display settings"
          >
            {updateDisplaySettings.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Display Settings"
            )}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
