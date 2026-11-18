import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { cn } from "@/lib/utils";
import { ocrExtractedDataSchema, OcrExtractedData } from "@shared/schema";
import { useEffect, useState } from "react";
import { useMerchants } from "../../hooks/use-settings";

interface ReceiptReviewFormProps {
  initialData?: OcrExtractedData;
  onSubmit: (data: OcrExtractedData) => void;
  isSubmitting?: boolean;
}

export function ReceiptReviewForm({
  initialData,
  onSubmit,
  isSubmitting,
}: ReceiptReviewFormProps) {
  const [merchantOpen, setMerchantOpen] = useState(false);
  const { data: merchants = [], isLoading: merchantsLoading } = useMerchants();

  const form = useForm<OcrExtractedData>({
    resolver: zodResolver(ocrExtractedDataSchema),
    defaultValues: {
      merchantName: initialData?.merchantName || "",
      amount: initialData?.amount || "",
      date: initialData?.date || "",
      tax: initialData?.tax || "",
    },
  });

  // Update form when initialData changes (e.g. after OCR completes)
  useEffect(() => {
    if (initialData) {
      form.reset({
        merchantName: initialData.merchantName || "",
        amount: initialData.amount || "",
        date: initialData.date || "",
        tax: initialData.tax || "",
      });
    }
  }, [initialData, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="merchantName"
          render={({ field }) => {
            // Check if OCR-detected name is different from any existing merchant
            const ocrName = initialData?.merchantName;
            const ocrNameIsNew = ocrName && !merchants.some(
              (m) => m.name.toLowerCase() === ocrName.toLowerCase()
            );

            return (
              <FormItem className="flex flex-col">
                <FormLabel>Merchant</FormLabel>
                <Popover open={merchantOpen} onOpenChange={setMerchantOpen}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={merchantOpen}
                        className={cn(
                          "w-full justify-between font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        {field.value || "Select merchant..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search merchants..." />
                      <CommandList>
                        <CommandEmpty>
                          {merchantsLoading ? "Loading..." : "No merchant found."}
                        </CommandEmpty>
                        {/* Show OCR-detected name as option if it's new */}
                        {ocrNameIsNew && (
                          <CommandGroup heading="From Receipt">
                            <CommandItem
                              value={ocrName}
                              onSelect={() => {
                                field.onChange(ocrName);
                                setMerchantOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  field.value === ocrName
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              {ocrName}
                              <span className="ml-auto text-xs text-muted-foreground">New</span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                        <CommandGroup heading="Existing Merchants">
                          {merchants.map((merchant) => (
                            <CommandItem
                              key={merchant.id}
                              value={merchant.name}
                              onSelect={() => {
                                field.onChange(merchant.name);
                                setMerchantOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  field.value === merchant.name
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              {merchant.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Total Amount</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="tax"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tax (Optional)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm & Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
