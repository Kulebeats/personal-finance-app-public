import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseMoneyInputDecimal, parseMoneyString } from "@/lib/money";

type InvestmentIncomeFormProps = {
  grossAmount: string;
  onGrossAmountChange: (value: string) => void;
  whtRate: string;
  onWhtRateChange: (value: string) => void;
  customWht: boolean;
  onCustomWhtChange: (value: boolean) => void;
  transactionDate: string;
  onTransactionDateChange: (value: string) => void;
  formatCurrency: (value: number, currency?: string) => string;
  currency?: string | null;
};

export function InvestmentIncomeForm({
  grossAmount,
  onGrossAmountChange,
  whtRate,
  onWhtRateChange,
  customWht,
  onCustomWhtChange,
  transactionDate,
  onTransactionDateChange,
  formatCurrency,
  currency,
}: InvestmentIncomeFormProps) {
  const grossDecimal =
    parseMoneyInputDecimal(grossAmount) ?? parseMoneyString(0);
  const whtDecimal = (
    parseMoneyInputDecimal(whtRate) ?? parseMoneyString(0)
  ).dividedBy(100);
  const whtAmountDecimal = grossDecimal.times(whtDecimal);
  const netAmountDecimal = grossDecimal.minus(whtAmountDecimal);

  const gross = grossDecimal.toNumber();
  const whtAmount = whtAmountDecimal.toNumber();
  const netAmount = netAmountDecimal.toNumber();

  return (
    <>
      <div className="space-y-2">
        <Label>Gross Amount</Label>
        <Input
          type="number"
          placeholder="1000.00"
          value={grossAmount}
          onChange={(event) => onGrossAmountChange(event.target.value)}
          min="0"
          step="0.01"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>WHT Rate (%)</Label>
          <Select
            value={customWht ? "custom" : whtRate}
            onValueChange={(value) => {
              if (value === "custom") {
                onCustomWhtChange(true);
              } else {
                onCustomWhtChange(false);
                onWhtRateChange(value);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0% (Exempt)</SelectItem>
              <SelectItem value="15">15% (Standard)</SelectItem>
              <SelectItem value="20">20%</SelectItem>
              <SelectItem value="custom">Custom Rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {customWht && (
          <div className="space-y-2">
            <Label>Custom Rate (%)</Label>
            <Input
              type="number"
              placeholder="15"
              value={whtRate}
              onChange={(event) => onWhtRateChange(event.target.value)}
              min="0"
              max="100"
              step="0.1"
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Payment Date</Label>
        <Input
          type="date"
          value={transactionDate}
          onChange={(event) => onTransactionDateChange(event.target.value)}
        />
      </div>

      {gross > 0 && (
        <div className="p-4 bg-muted/50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Gross Amount</span>
            <span>{formatCurrency(gross, currency ?? undefined)}</span>
          </div>
          <div className="flex justify-between text-sm text-rose-600">
            <span>WHT Deducted ({whtRate}%)</span>
            <span>-{formatCurrency(whtAmount, currency ?? undefined)}</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-muted-foreground">Net Amount</span>
            <span className="font-bold text-emerald-600">
              {formatCurrency(netAmount, currency ?? undefined)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
