import type { UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { DEFAULT_RECURRING_FREQUENCY } from "@/lib/recurringTransactionRequest";
import type { TransactionFormValues } from "./schema";

interface RecurringToggleFieldProps {
  form: UseFormReturn<TransactionFormValues>;
}

/**
 * "Recurring Transaction" switch. Turning it on preselects a frequency
 * (repeating from the transaction date) unless the user already chose one,
 * so a recurring submit always carries a cadence (NEW-10).
 */
export function RecurringToggleField({ form }: RecurringToggleFieldProps) {
  return (
    <FormField
      control={form.control}
      name="isRecurring"
      render={({ field }) => (
        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => {
                field.onChange(checked);
                if (checked === true && !form.getValues("recurringFrequency")) {
                  form.setValue("recurringFrequency", DEFAULT_RECURRING_FREQUENCY);
                }
              }}
            />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel>Recurring Transaction</FormLabel>
            <FormDescription>
              This is a repeating transaction (e.g. subscription, rent)
            </FormDescription>
          </div>
        </FormItem>
      )}
    />
  );
}
