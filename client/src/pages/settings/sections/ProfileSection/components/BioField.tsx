import React from "react";
import { Controller, UseFormReturn } from "react-hook-form";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/features/settings/components";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";

interface BioFieldProps {
  form: UseFormReturn<ProfileFormData>;
}

const MAX_BIO_LENGTH = 1000;

export function BioField({ form }: BioFieldProps) {
  const {
    control,
    watch,
    formState: { errors },
  } = form;

  const bioValue = watch("bio") || "";
  const charCount = bioValue.length;
  const isNearLimit = charCount > MAX_BIO_LENGTH * 0.9;
  const isOverLimit = charCount > MAX_BIO_LENGTH;

  return (
    <Controller
      name="bio"
      control={control}
      render={({ field }) => (
        <FormField
          label="About Me"
          htmlFor="bio"
          tooltip="Share a brief introduction about yourself."
          error={errors.bio?.message}
        >
          <Textarea
            {...field}
            value={field.value || ""}
            id="bio"
            placeholder="Tell us a bit about yourself..."
            className="min-h-[120px] input-glass resize-none"
            maxLength={MAX_BIO_LENGTH + 50}
          />
          <div className="flex justify-end mt-1">
            <span
              className={`text-xs ${
                isOverLimit
                  ? "text-destructive font-medium"
                  : isNearLimit
                  ? "text-amber-600"
                  : "text-muted-foreground"
              }`}
            >
              {charCount} / {MAX_BIO_LENGTH}
            </span>
          </div>
        </FormField>
      )}
    />
  );
}
