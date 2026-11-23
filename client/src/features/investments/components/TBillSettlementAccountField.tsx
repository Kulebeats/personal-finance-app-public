import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SettlementAccountOption {
  id: string;
  name: string;
}

interface TBillSettlementAccountFieldProps {
  value: string;
  onChange: (accountId: string) => void;
  accounts: SettlementAccountOption[];
}

/**
 * A-42: the account a T-bill's maturity pays into. Required, because the
 * maturity run cannot settle a bill that names no account. Rendered inside a
 * FormField so the label, control and message share its ids.
 */
export function TBillSettlementAccountField({ value, onChange, accounts }: TBillSettlementAccountFieldProps) {
  return (
    <FormItem>
      <FormLabel>Settlement account</FormLabel>
      <Select value={value} onValueChange={onChange}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {accounts.map(account => (
            <SelectItem key={account.id} value={account.id}>{account.name} (ZMW)</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FormDescription>
        {accounts.length > 0
          ? "At maturity, confirm the receipt to credit the face value, less withholding tax, to this account."
          : "Add a ZMW asset account first: you confirm the receipt into it at maturity."}
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
}
