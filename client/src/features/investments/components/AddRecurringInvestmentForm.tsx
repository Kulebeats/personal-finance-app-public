import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateRecurringInvestment,
  useSecurities,
} from "@/hooks/useInvestments";
import { useAccounts } from "@/hooks/useAccounts";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const recurringSchema = z.object({
  accountId: z.string().uuid("Please select an account"),
  securityId: z.string().uuid("Please select a security"),
  type: z.enum(["sip", "rollover"]),
  frequency: z.enum(["monthly", "quarterly", "semi_annually", "yearly"]),
  amount: z.string().min(1, "Amount is required"),
  currency: z.string().default("ZMW"),
  nextExecutionDate: z.string().min(1, "Date is required"),
});

type RecurringFormData = z.infer<typeof recurringSchema>;

interface AddRecurringInvestmentFormProps {
  onSuccess: () => void;
}

export function AddRecurringInvestmentForm({
  onSuccess,
}: AddRecurringInvestmentFormProps) {
  const { data: accounts } = useAccounts();
  const { data: securities } = useSecurities();
  const createMutation = useCreateRecurringInvestment();

  const form = useForm<RecurringFormData>({
    resolver: zodResolver(recurringSchema),
    defaultValues: {
      type: "sip",
      frequency: "monthly",
      currency: "ZMW",
      nextExecutionDate: new Date(new Date().setDate(new Date().getDate() + 1))
        .toISOString()
        .split("T")[0],
      amount: "",
    },
  });

  const onSubmit = (data: RecurringFormData) => {
    createMutation.mutate(data, {
      onSuccess: () => onSuccess(),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Automation Type</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="sip">SIP (New Investment)</SelectItem>
                    <SelectItem value="rollover">Auto-Rollover</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="frequency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Frequency</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="semi_annually">Semi-Annually</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="accountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Funding Account</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {accounts?.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Account to deduct funds from</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="securityId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Target Security</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select security" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {securities?.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      {sec.symbol} - {sec.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nextExecutionDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "Setting up..." : "Confirm Setup"}
        </Button>
      </form>
    </Form>
  );
}
