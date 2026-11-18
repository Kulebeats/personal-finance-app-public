import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMoneyInputNumber } from "@/lib/money";

type InvestmentBuySellFormProps = {
  transactionType: "buy" | "sell";
  quantity: string;
  onQuantityChange: (value: string) => void;
  price: string;
  onPriceChange: (value: string) => void;
  transactionDate: string;
  onTransactionDateChange: (value: string) => void;
  currentQuantity: number;
  pricePlaceholder: string;
  isValidSell: boolean;
  totalValue: number;
  newQuantityAfterSell: number;
  formatCurrency: (value: number, currency?: string) => string;
  currency?: string | null;
};

export function InvestmentBuySellForm({
  transactionType,
  quantity,
  onQuantityChange,
  price,
  onPriceChange,
  transactionDate,
  onTransactionDateChange,
  currentQuantity,
  pricePlaceholder,
  isValidSell,
  totalValue,
  newQuantityAfterSell,
  formatCurrency,
  currency,
}: InvestmentBuySellFormProps) {
  const qty = parseMoneyInputNumber(quantity) ?? 0;
  const prc = parseMoneyInputNumber(price) ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Quantity</Label>
          <Input
            type="number"
            placeholder="100"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
            min="0"
            step="1"
          />
          {transactionType === "sell" && !isValidSell && qty > 0 && (
            <p className="text-xs text-rose-600">
              Cannot sell more than {currentQuantity} shares
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Price per Share</Label>
          <Input
            type="number"
            placeholder={pricePlaceholder}
            value={price}
            onChange={(event) => onPriceChange(event.target.value)}
            min="0"
            step="0.01"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Transaction Date</Label>
        <Input
          type="date"
          value={transactionDate}
          onChange={(event) => onTransactionDateChange(event.target.value)}
        />
      </div>

      {qty > 0 && prc > 0 && (
        <div className="p-4 bg-muted/50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              Total {transactionType === "buy" ? "Cost" : "Proceeds"}
            </span>
            <span className="font-bold">
              {formatCurrency(totalValue, currency ?? undefined)}
            </span>
          </div>
          {transactionType === "sell" && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining Shares</span>
              <span className="font-medium">
                {newQuantityAfterSell.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
