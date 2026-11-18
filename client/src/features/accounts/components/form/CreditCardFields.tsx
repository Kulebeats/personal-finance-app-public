import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * CreditCardFields - Extracted from AccountDetailsForm (TODO-029)
 * Fields specific to credit card accounts: balance, limit, APR, statement day
 */
export interface CreditCardFieldsProps {
  balance: string;
  onBalanceChange: (value: string) => void;
  creditLimit: string;
  onCreditLimitChange: (value: string) => void;
  apr: string;
  onAprChange: (value: string) => void;
  statementDay: string;
  onStatementDayChange: (value: string) => void;
}

export function CreditCardFields({
  balance,
  onBalanceChange,
  creditLimit,
  onCreditLimitChange,
  apr,
  onAprChange,
  statementDay,
  onStatementDayChange,
}: CreditCardFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="balance">Current Balance (Owed)</Label>
          <Input
            id="balance"
            type="number"
            placeholder="0.00"
            value={balance}
            onChange={(event) => onBalanceChange(event.target.value)}
            className="bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="limit">Credit Limit</Label>
          <Input
            id="limit"
            type="number"
            placeholder=""
            value={creditLimit}
            onChange={(event) => onCreditLimitChange(event.target.value)}
            className="bg-background"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="apr">APR %</Label>
          <Input
            id="apr"
            placeholder=""
            value={apr}
            onChange={(event) => onAprChange(event.target.value)}
            className="bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="due">Statement Day</Label>
          <Input
            id="due"
            type="number"
            min={1}
            max={31}
            placeholder=""
            value={statementDay}
            onChange={(event) => onStatementDayChange(event.target.value)}
            className="bg-background"
          />
        </div>
      </div>
    </>
  );
}
