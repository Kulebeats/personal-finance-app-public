import { UseFormReturn } from "react-hook-form";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { MerchantCombobox } from "@/components/merchants/MerchantCombobox";
import { OwnerSelector } from "@/components/OwnerSelector";
import { AnimatedSegmentedControl } from "./AnimatedSegmentedControl";
import { TransactionFormValues } from "./schema";
import { cleanMerchantName } from "@/lib/transactionFormUtils";
import { useMemo } from "react";
import type { Account, Category } from "@/lib/api";
import type { Merchant } from "@/hooks/use-settings";

interface TransactionSettings {
  currency: string;
  dateFormat?: string;
}

interface ReceiptHandler {
  setScanModalOpen: (open: boolean) => void;
  isOcrProcessing: boolean;
}

interface MerchantCreator {
  isPending: boolean;
  mutateAsync?: (data: { name: string; logoUrl: string | null }) => Promise<Merchant>;
}

interface TransactionFormFieldsProps {
  form: UseFormReturn<TransactionFormValues>;
  settings: TransactionSettings;
  accounts: Account[];
  categories: Category[];
  isEditMode: boolean;
  isTransferTransaction: boolean;
  receipt: ReceiptHandler;
  createMerchant: MerchantCreator;
  isLoading: {
    accounts: boolean;
    categories: boolean;
  };
}

export function TransactionFormFields({
  form,
  settings,
  accounts,
  categories,
  isEditMode,
  isTransferTransaction,
  receipt,
  createMerchant,
  isLoading,
}: TransactionFormFieldsProps) {
  const type = form.watch("type");
  const isTransferMode = type === "transfer";
  const isIncomeMode = type === "income";
  const merchantNameValue = form.watch("merchantName") || "";
  const merchantIdValue = form.watch("merchantId") || "";
  const fromAccountId = form.watch("accountId");
  const disableTransferSelection = isEditMode && !isTransferTransaction;

  // Filter categories based on transaction type
  const filteredCategories = useMemo(() => {
    if (isTransferMode) return [];
    if (type === "expense") {
      return categories.filter((c) => c.groupType === "expenses");
    }
    if (type === "income") {
      return categories.filter((c) => c.groupType === "income");
    }
    return categories;
  }, [categories, type, isTransferMode]);

  const groupedCategories = useMemo(() => {
    if (filteredCategories.length === 0) return [];
    const grouped = new Map<string, typeof filteredCategories>();
    for (const category of filteredCategories) {
      const groupName = category.groupName || "Other";
      const group = grouped.get(groupName);
      if (group) {
        group.push(category);
      } else {
        grouped.set(groupName, [category]);
      }
    }
    return Array.from(grouped.entries());
  }, [filteredCategories]);

  const handleMerchantInputChange = () => {
    if (merchantIdValue) {
      form.setValue("merchantId", "", { shouldValidate: true });
    }
  };

  const handleMerchantSelect = (merchant: {
    id: string;
    name: string;
    defaultCategoryId?: string | null;
  }) => {
    form.setValue("merchantName", merchant.name, { shouldValidate: true });
    form.setValue("merchantId", merchant.id, { shouldValidate: true });
    if (!isTransferMode && merchant.defaultCategoryId) {
      form.setValue("categoryId", merchant.defaultCategoryId, {
        shouldValidate: true,
      });
    }
  };

  const handleCreateMerchant = async (name: string) => {
    const cleanedName = cleanMerchantName(name);
    if (!cleanedName || createMerchant.isPending || !createMerchant.mutateAsync) return null;
    try {
      const created = await createMerchant.mutateAsync({
        name: cleanedName,
        logoUrl: null,
      });
      return created;
    } catch (error) {
      console.error("Failed to create merchant:", error);
      return null;
    }
  };

  const clearMerchantSelection = () => {
    form.setValue("merchantName", "", { shouldValidate: true });
    form.setValue("merchantId", "", { shouldValidate: true });
  };

  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="type"
        render={({ field }) => (
          <FormItem className="space-y-1">
            <FormLabel>Type</FormLabel>
            <FormControl>
              <>
                <AnimatedSegmentedControl
                  value={field.value}
                  onChange={(value) => {
                    if (isTransferTransaction) return;
                    if (disableTransferSelection && value === "transfer") {
                      return;
                    }
                    field.onChange(value);
                  }}
                  options={[
                    {
                      value: "expense",
                      label: "DEBIT (Expense)",
                      color: "red",
                      disabled: isTransferTransaction,
                    },
                    {
                      value: "income",
                      label: "CREDIT (Income)",
                      color: "green",
                      disabled: isTransferTransaction,
                    },
                    {
                      value: "transfer",
                      label: "TRANSFER",
                      color: "blue",
                      disabled: disableTransferSelection,
                    },
                  ]}
                />
                <div className="flex justify-end mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => receipt.setScanModalOpen(true)}
                    disabled={receipt.isOcrProcessing}
                  >
                    {receipt.isOcrProcessing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="mr-2 h-4 w-4" />
                    )}
                    {receipt.isOcrProcessing
                      ? "Scanning..."
                      : "Scan Receipt to Autofill"}
                  </Button>
                </div>
              </>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-lg font-semibold text-muted-foreground">
                    {settings.currency}
                  </span>
                  <Input
                    placeholder="0.00"
                    className={cn(
                      "pl-16 text-lg font-semibold transition-colors duration-200",
                      type === "income"
                        ? "text-green-600"
                        : type === "expense"
                        ? "text-red-600"
                        : "text-foreground"
                    )}
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) =>
                      date > new Date() || date < new Date("1900-01-01")
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="merchantName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {isTransferMode ? "Description (Optional)" : "Merchant / Name"}
            </FormLabel>
            {isTransferMode ? (
              <FormControl>
                <Input placeholder="e.g. Savings transfer" {...field} />
              </FormControl>
            ) : (
              <FormControl>
                <MerchantCombobox
                  value={merchantNameValue}
                  selectedMerchantId={merchantIdValue}
                  onInputChange={(value) => {
                    field.onChange(value);
                    handleMerchantInputChange();
                  }}
                  onSelect={handleMerchantSelect}
                  onCreate={handleCreateMerchant}
                  onClear={clearMerchantSelection}
                  isCreatePending={createMerchant.isPending}
                  placeholder={
                    isIncomeMode ? "Income (auto)" : "Select merchant"
                  }
                  disabled={isIncomeMode}
                />
              </FormControl>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="accountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {isTransferMode ? "From Account" : "Account"}
              </FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={
                  isLoading.accounts || (isEditMode && !isTransferTransaction)
                }
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoading.accounts ? "Loading..." : "Select account"
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {isTransferMode ? (
          <FormField
            control={form.control}
            name="toAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>To Account</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={
                    isLoading.accounts || (isEditMode && !isTransferTransaction)
                  }
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          isLoading.accounts
                            ? "Loading..."
                            : "Select destination"
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {accounts
                      ?.filter((account) =>
                        fromAccountId ? account.id !== fromAccountId : true
                      )
                      .map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={isLoading.categories}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          isLoading.categories
                            ? "Loading..."
                            : "Select category"
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value="_uncategorized">
                      Uncategorized
                    </SelectItem>
                    {groupedCategories.map(([groupName, groupCategories]) => (
                      <SelectGroup key={groupName}>
                        <SelectLabel>{groupName}</SelectLabel>
                        {groupCategories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.icon ? (
                              <span className="mr-2">{category.icon}</span>
                            ) : null}
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>

      <FormField
        control={form.control}
        name="ownerUserId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Owner</FormLabel>
            <FormControl>
              <OwnerSelector
                value={field.value ?? null}
                onChange={field.onChange}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Add details about this transaction..."
                className="resize-none"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
