import { useEffect, useLayoutEffect, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { isCanonicalImportDate } from "@shared/import-date";
import {
  useCreateRecurringInvestment,
  useSecurities,
} from "@/hooks/useInvestments";
import { useAccounts } from "@/hooks/useAccounts";
import { useDisplaySettings } from "@/hooks/use-settings";
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
import { nextRecurringInvestmentDate } from "./nextRecurringInvestmentDate";

function fixedNativeAmount(value: string): string | null {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match || match[0] !== value) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  if (whole.length > 13 || (whole === "0" && cents === "00")) return null;
  return `${whole}.${cents}`;
}

const recurringSchema = z.object({
  accountId: z.string().uuid("Please select an account"),
  securityId: z.string().uuid("Please select a security"),
  type: z.enum(["sip", "rollover"]),
  frequency: z.enum(["monthly", "quarterly", "semi_annually", "yearly"]),
  amount: z.string().transform((value, context) => {
    const amount = fixedNativeAmount(value);
    if (amount !== null) return amount;
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a positive amount with up to two decimal places and thirteen whole digits." });
    return z.NEVER;
  }),
  nextExecutionDate: z.string().refine(date => !date.startsWith("0000-") && isCanonicalImportDate(date), "Enter a valid initial date"),
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
  const { data: displaySettings, isLoading: settingsLoading, isError: settingsError } = useDisplaySettings();
  const commands = useCreateRecurringInvestment();
  // Input intent includes clears and unchanged values that are not dirty to React Hook Form.
  const dateInitialized = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const form = useForm<RecurringFormData>({
    resolver: zodResolver(recurringSchema),
    defaultValues: {
      type: "sip",
      frequency: "monthly",
      accountId: "",
      securityId: "",
      nextExecutionDate: "",
      amount: "",
    },
  });

  const securityId = useWatch({ control: form.control, name: "securityId" });
  const security = securities?.find(item => item.id === securityId);
  const draft = commands.createDraft;
  const timezone = displaySettings?.timezone;
  const { setValue } = form;
  useEffect(() => {
    if (draft) { dateInitialized.current = true; return; }
    if (dateInitialized.current || commands.pending || settingsLoading || settingsError || !timezone) return;
    const nextDate = nextRecurringInvestmentDate(timezone);
    if (nextDate === null) return;
    dateInitialized.current = true;
    setValue("nextExecutionDate", nextDate);
  }, [draft, commands.pending, timezone, settingsLoading, settingsError, setValue]);
  const currency = draft?.terms.currency ?? security?.currency?.toUpperCase();
  const locked = !commands.allowed || commands.pending !== null;
  const custodyLabel = (account: { name: string; currency: string }) => `${account.name} (${account.currency})`;
  const instrumentLabel = (instrument: { symbol: string; name: string }) => `${instrument.symbol} - ${instrument.name}`;

  const finish = async (result: Promise<boolean>) => {
    if (await result && mounted.current && commands.isCurrent()) onSuccess();
  };
  const onSubmit = async (data: RecurringFormData) => {
    if (!mounted.current || !commands.isCurrent()) return;
    const account = accounts?.find(item => item.id === data.accountId);
    const instrument = securities?.find(item => item.id === data.securityId);
    if (!account) {
      form.setError("accountId", { message: "Select a current custody account." });
      return;
    }
    const nativeCurrency = instrument?.currency?.toUpperCase();
    if (!instrument || !nativeCurrency || !/^[A-Z]{3}$/.test(nativeCurrency)) {
      form.setError("securityId", { message: "Select an instrument with a known denomination." });
      return;
    }
    await finish(commands.create({ ...data, currency: nativeCurrency }, {
      account: custodyLabel(account), instrument: instrumentLabel(instrument),
    }));
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
                  value={draft?.terms.type ?? field.value}
                  disabled={locked}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type">
                        {draft ? (draft.terms.type === "sip" ? "SIP (New Investment)" : "Auto-Rollover") : undefined}
                      </SelectValue>
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
                  value={draft?.terms.frequency ?? field.value}
                  disabled={locked}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency">
                        {draft ? frequencyLabels[draft.terms.frequency] : undefined}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(frequencyLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
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
              <FormLabel>Custody account</FormLabel>
              <Select onValueChange={field.onChange} value={draft?.terms.accountId ?? field.value} disabled={locked}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account">{draft?.labels.account}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {accounts?.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {custodyLabel(acc)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Account where purchases are recorded.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="securityId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Instrument</FormLabel>
              <Select onValueChange={field.onChange} value={draft?.terms.securityId ?? field.value} disabled={locked}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select instrument">{draft?.labels.instrument}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {securities?.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      {instrumentLabel(sec)}
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
                <FormLabel>Amount{currency ? ` (${currency})` : ""}</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" placeholder="0.00" {...field} value={draft?.terms.amount ?? field.value} disabled={locked} />
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
                <FormLabel>Initial date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={draft?.terms.nextExecutionDate ?? field.value} disabled={locked}
                    onInput={() => { dateInitialized.current = true; }}
                    onChange={event => { dateInitialized.current = true; field.onChange(event); }} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {commands.message && commands.messageKind === "create" && <p role="alert">
          {commands.message}{commands.retryDenied && " You can close this form to review the list and return to the original request."}
        </p>}
        {commands.pending && commands.pending.kind !== "create" && <p role="status">Resolve the current recurring plan request before confirming another.</p>}
        {draft && commands.uncertain ? (
          <Button type="button" className="w-full" onClick={() => void finish(commands.retry())} disabled={!commands.allowed}>
            Retry same plan
          </Button>
        ) : (
          <Button type="submit" className="w-full" disabled={locked}>
            {draft && commands.busy ? "Recording plan…" : "Confirm Setup"}
          </Button>
        )}
      </form>
    </Form>
  );
}

const frequencyLabels = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annually: "Semi-Annually",
  yearly: "Yearly",
} as const;
