import type { UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { TransactionFormValues } from "./schema";

/** Shown while privacy cannot apply (NEW-10). */
export const RECURRING_PRIVACY_NOTE = "Recurring transactions can't be private yet. They are shared with your household.";

export function TransactionPrivacyField({ form }: { form: UseFormReturn<TransactionFormValues> }) {
  // A transfer has its own workflow. Keep an existing ordinary selection
  // visible until the user explicitly clears it or switches back.
  if (form.watch("type") === "transfer" && !form.watch("isPrivate")) return null;
  // POST /recurring/transaction has no privacy field, so recurring cannot be
  // private. Stay enabled while ticked so the user can still clear it.
  const recurringBlocksPrivacy = form.watch("isRecurring") === true;
  return <FormField control={form.control} name="isPrivate" render={({ field }) => <FormItem className="rounded-md border p-3">
    <div className="flex items-center gap-2"><FormControl><Checkbox checked={field.value === true}
      disabled={recurringBlocksPrivacy && field.value !== true} onCheckedChange={value => {
        field.onChange(value === true); form.clearErrors("isPrivate");
      }} /></FormControl><FormLabel>Private transaction</FormLabel></div>
    <FormDescription>{recurringBlocksPrivacy ? RECURRING_PRIVACY_NOTE
      : "Visible only to you. Choose Me as Owner for a private transaction. Account visibility still applies."}</FormDescription>
    <FormMessage />
  </FormItem>} />;
}
