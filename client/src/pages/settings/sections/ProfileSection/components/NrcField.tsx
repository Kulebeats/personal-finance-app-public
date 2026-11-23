import { Controller, type Control, type FieldErrors } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FormField } from "@/features/settings/components/FormField";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";
import { NRC_FIELD_MODE, type ProfileFieldMode } from "@shared/profile-policy";

const NRC_DIGITS = 9;

interface NrcFieldProps {
  control: Control<ProfileFormData>;
  errors: FieldErrors<ProfileFormData>;
  /** Defaults to the shared NRC_FIELD_MODE; tests pass a mode explicitly. */
  mode?: ProfileFieldMode;
}

/** Digits only, shown as 123456/78/9 while typing. */
function formatNrc(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, NRC_DIGITS);
  if (digits.length <= 6) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 6)}/${digits.slice(6)}`;
  return `${digits.slice(0, 6)}/${digits.slice(6, 8)}/${digits.slice(8)}`;
}

/**
 * National Registration Card number (AH-07). NRC_FIELD_MODE decides whether it
 * is collected ("editable"), shown greyed out ("readonly") or not shown at all
 * ("hidden"); the server accepts a change only while it is editable.
 */
export function NrcField({ control, errors, mode = NRC_FIELD_MODE }: NrcFieldProps) {
  if (mode === "hidden") return null;
  const isReadOnly = mode === "readonly";
  const note = isReadOnly
    ? "Your NRC can't be changed at the moment."
    : "Only you can see your NRC. Leave it empty to remove it.";

  return (
    <div className="pt-2">
      <Controller
        name="nrc"
        control={control}
        render={({ field }) => (
          <FormField
            label="National Registration Card (NRC)"
            error={errors.nrc?.message as string}
            htmlFor="nrc"
          >
            <Input
              {...field}
              value={field.value || ""}
              id="nrc"
              disabled={isReadOnly}
              aria-describedby="nrc-note"
              onChange={(event) => field.onChange(formatNrc(event.target.value))}
              placeholder="123456/78/9"
              maxLength={11}
              inputMode="numeric"
              autoComplete="off"
              className="input-glass transition-all focus:scale-[1.01] focus:shadow-md"
            />
            <p id="nrc-note" className="mt-1 text-xs text-muted-foreground">{note}</p>
          </FormField>
        )}
      />
    </div>
  );
}
