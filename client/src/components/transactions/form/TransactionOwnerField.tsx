import type { UseFormReturn } from "react-hook-form";
import { OwnerSelector } from "@/components/OwnerSelector";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { TransactionFormValues } from "./schema";

interface TransactionOwnerFieldProps {
  form: UseFormReturn<TransactionFormValues>;
  isEditMode: boolean;
}

/** Shown while the owner choice cannot apply (NEW-10). */
export const RECURRING_OWNER_NOTE = "A recurring transaction and its rule belong to you, the person saving it.";

/**
 * Owner picker. POST /recurring/transaction has no owner field and the server
 * makes the saver the owner, so while a new transaction is recurring the
 * picker is disabled and says so instead of offering a choice that is ignored.
 */
export function TransactionOwnerField({ form, isEditMode }: TransactionOwnerFieldProps) {
  const isRecurringCreate = !isEditMode && form.watch("isRecurring") === true && form.watch("type") !== "transfer";
  return (
    <FormField
      control={form.control}
      name="ownerUserId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Owner</FormLabel>
          <FormControl>
            <OwnerSelector value={field.value ?? null} onChange={field.onChange} disabled={isRecurringCreate} />
          </FormControl>
          {isRecurringCreate && <FormDescription>{RECURRING_OWNER_NOTE}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
