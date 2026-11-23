import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Decimal from "decimal.js";
import { parseMoneyInputDecimal } from "@/lib/money";

// A 15-digit gross amount times a percentage with four fractional digits
// must stay exact until the single rounding of the withheld amount.
const IncomeDecimal = Decimal.clone({ precision: 32 });

export function calculateInvestmentIncome(grossAmount: string, rate: string) {
  const gross = parseMoneyInputDecimal(grossAmount);
  const percent = parseMoneyInputDecimal(rate);
  if (!gross || gross.lte(0) || gross.gte("10000000000000") || gross.decimalPlaces() > 2 ||
      !percent || percent.lt(0) || percent.gt(100) || percent.decimalPlaces() > 4) return null;
  const withheld = new IncomeDecimal(gross).times(percent).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { gross, withheld, net: gross.minus(withheld) };
}

type InvestmentIncomeFormProps = {
  income: ReturnType<typeof calculateInvestmentIncome>;
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
  income,
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
                onWhtRateChange("");
              } else {
                onCustomWhtChange(false);
                onWhtRateChange(value);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose the recorded rate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0%</SelectItem>
              <SelectItem value="15">15%</SelectItem>
              <SelectItem value="20">20%</SelectItem>
              <SelectItem value="custom">Custom Rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {customWht && (
          <div className="space-y-2">
            <Label htmlFor="investment-income-custom-rate">Custom Rate (%) · up to 4 decimal places</Label>
            <Input
              id="investment-income-custom-rate"
              type="number"
              placeholder="15"
              value={whtRate}
              onChange={(event) => onWhtRateChange(event.target.value)}
              min="0"
              max="100"
              step="0.0001"
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

      {income && currency && (
        <div className="p-4 bg-muted/50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Gross Amount</span>
            <span>{formatCurrency(income.gross.toNumber(), currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-rose-600">
            <span>WHT Deducted ({whtRate}%)</span>
            <span>-{formatCurrency(income.withheld.toNumber(), currency)}</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-muted-foreground">Net Amount</span>
            <span className="font-bold text-emerald-600">
              {formatCurrency(income.net.toNumber(), currency)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
