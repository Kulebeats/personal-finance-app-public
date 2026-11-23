import { Input } from "@/components/ui/input";
import { useId } from "react";
import Decimal from "decimal.js";
import { Label } from "@/components/ui/label";
import { parseMoneyInputDecimal, parseMoneyInputNumber } from "@/lib/money";

const TradeDecimal = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });

export function calculateTradeSettlement(type: "buy" | "sell", quantity: string, price: string, fee: string) {
  const shares = parseMoneyInputDecimal(quantity);
  const unitPrice = parseMoneyInputDecimal(price);
  const charge = parseMoneyInputDecimal(fee || "0");
  if (!shares?.gt(0) || shares.gte("1e10") || shares.dp() > 8 ||
      !unitPrice?.gt(0) || unitPrice.gte("1e11") || unitPrice.dp() > 4 ||
      !charge || charge.lt(0) || charge.gte("1e13") || charge.dp() > 2) return null;
  const gross = new TradeDecimal(shares).times(unitPrice).toDecimalPlaces(2);
  const amount = type === "buy" ? gross.plus(charge) : gross.minus(charge);
  if (amount.lt(0) || amount.gte("1e13")) return null;
  return { quantity: shares.toFixed(), price: unitPrice.toFixed(), amount: amount.toFixed(2),
    ...(fee !== "" && { fees: charge.toFixed(2) }) };
}

type InvestmentBuySellFormProps = {
  transactionType: "buy" | "sell";
  quantity: string;
  onQuantityChange: (value: string) => void;
  price: string;
  onPriceChange: (value: string) => void;
  fee: string;
  onFeeChange: (value: string) => void;
  transactionDate: string;
  onTransactionDateChange: (value: string) => void;
  currentQuantity: string;
  pricePlaceholder: string;
  isValidSell: boolean;
  totalValue: number | null;
  newQuantityAfterSell: string;
  formatCurrency: (value: number, currency?: string) => string;
  currency?: string | null;
};

export function InvestmentBuySellForm({
  transactionType,
  quantity,
  onQuantityChange,
  price,
  onPriceChange,
  fee,
  onFeeChange,
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
  const id = useId();
  const qty = parseMoneyInputNumber(quantity) ?? 0;
  const prc = parseMoneyInputNumber(price) ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={id + "-qty"}>Quantity</Label>
          <Input
            id={id + "-qty"}
            type="number"
            placeholder="100"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
            min="0"
            step="0.00000001"
          />
          {transactionType === "sell" && !isValidSell && qty > 0 && (
            <p className="text-xs text-rose-600">
              Cannot sell more than {currentQuantity} shares
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={id + "-price"}>Price per Share</Label>
          <Input
            id={id + "-price"}
            type="number"
            placeholder={pricePlaceholder}
            value={price}
            onChange={(event) => onPriceChange(event.target.value)}
            min="0"
            step="0.0001"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id + "-fee"}>Trade fee</Label>
        <Input id={id + "-fee"} type="text" inputMode="decimal" placeholder="0.00"
          value={fee} onChange={(event) => onFeeChange(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id + "-date"}>Transaction Date</Label>
        <Input
          id={id + "-date"}
          type="date"
          value={transactionDate}
          onChange={(event) => onTransactionDateChange(event.target.value)}
        />
      </div>

      {!/^[A-Z]{3}$/.test(currency ?? "") && <p>Settlement unavailable until the holding has a valid currency.</p>}
      {qty > 0 && prc > 0 && totalValue !== null && (
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
                {newQuantityAfterSell}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
