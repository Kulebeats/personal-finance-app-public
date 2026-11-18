import { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { TagsMultiSelect } from "@/components/tags";
import { TransactionFormValues } from "./schema";

interface TagsSectionProps {
  form: UseFormReturn<TransactionFormValues>;
}

export function TagsSection({ form }: TagsSectionProps) {
  return (
    <FormField
      control={form.control}
      name="tags"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Tags</FormLabel>
          <FormControl>
            <TagsMultiSelect
              value={field.value || []}
              onChange={field.onChange}
              placeholder="Select tags..."
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
