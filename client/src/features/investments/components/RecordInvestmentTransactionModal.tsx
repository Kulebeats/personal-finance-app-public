import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, DollarSign } from "lucide-react";
import {
  useCreateInvestmentTransaction,
  type Holding,
} from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";
import {
  parseMoneyInputDecimal,
  parseMoneyString,
} from "@/lib/money";
import { cn } from "@/lib/utils";
import { calendarToday } from "@/lib/calendarZone";

import { calculateTradeSettlement, InvestmentBuySellForm } from "./InvestmentBuySellForm";
import { InvestmentHoldingSummary } from "./InvestmentHoldingSummary";
import { calculateInvestmentIncome, InvestmentIncomeForm } from "./InvestmentIncomeForm";
import { InvestmentTransactionTypeSelector } from "./InvestmentTransactionTypeSelector";
import { type TransactionType } from "./InvestmentTransactionTypes";

interface RecordInvestmentTransactionModalProps {
  holding: Holding;
  children: React.ReactNode;
  onSuccess?: () => void;
}

export function RecordInvestmentTransactionModal({
  holding,
  children,
  onSuccess,
}: RecordInvestmentTransactionModalProps) {
  const [open, setOpen] = useState(false);
  const [transactionType, setTransactionType] =
    useState<TransactionType>("buy");

  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [transactionDate, setTransactionDate] = useState(calendarToday);

  const [grossAmount, setGrossAmount] = useState("");
  const [whtRate, setWhtRate] = useState("");
  const [customWht, setCustomWht] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { formatCurrency } = useFormat();
  const createInvestmentTransaction = useCreateInvestmentTransaction();

  const currentQuantity = parseMoneyString(holding.quantity);
  const currency = holding.security?.currency;
  const validCurrency = !!currency && /^[A-Z]{3}$/.test(currency);
  const securitySymbol = holding.security?.symbol || "N/A";
  const securityName = holding.security?.name || "Unknown Security";

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setTransactionType("buy");
      setQuantity("");
      setFee("");
      setPrice("");
      setTransactionDate(calendarToday());
      setGrossAmount("");
      setWhtRate("");
      setCustomWht(false);
    }
    setOpen(nextOpen);
  };

  const qtyDecimal = parseMoneyInputDecimal(quantity) ?? parseMoneyString(0);
  const trade = validCurrency && (transactionType === "buy" || transactionType === "sell")
    ? calculateTradeSettlement(transactionType, quantity, price, fee) : null;
  const income = calculateInvestmentIncome(grossAmount, whtRate);

  const isValidSell =
    transactionType === "sell" ? qtyDecimal.lte(currentQuantity) : true;
  const newQuantityAfterSell = currentQuantity.minus(qtyDecimal).toFixed();

  const handleSubmit = async () => {
    if (!isFormValid() || !currency) return;
    setIsSubmitting(true);

    try {
      // P1-4 FIX: Define proper payload type instead of Record<string, any>
      const basePayload = {
        accountId: holding.accountId,
        holdingId: holding.id,
        securityId: holding.securityId,
        type: transactionType,
        transactionDate,
        currency,
      };

      // P1-4 FIX: Convert numbers to strings for API payload
      const payload =
        transactionType === "buy" || transactionType === "sell"
          ? trade && {
              ...basePayload,
              ...trade,
            }
          : income && {
              ...basePayload,
              amount: income.net.toFixed(2),
              withholdingTax: income.withheld.toFixed(2),
            };

      if (!payload) return;
      await createInvestmentTransaction.mutateAsync(payload);

      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to record transaction:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    if (transactionType === "buy" || transactionType === "sell") {
      return !!trade && isValidSell;
    }
    if (transactionType === "dividend" || transactionType === "interest") {
      return !!income && !!holding.security?.currency;
    }
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-orange-500" />
            Record Transaction
          </DialogTitle>
          <DialogDescription>Record a trade or income payment for this holding.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <InvestmentHoldingSummary
            securitySymbol={securitySymbol}
            securityName={securityName}
            currentQuantity={currentQuantity.toFixed()}
          />

          <div className="space-y-2">
            <Label>Transaction Type</Label>
            <InvestmentTransactionTypeSelector
              transactionType={transactionType}
              onChange={setTransactionType}
            />
          </div>

          {(transactionType === "buy" || transactionType === "sell") && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Enter the actual execution price from your trade confirmation.</p>
              {validCurrency && holding.security?.currentPrice !== null && holding.security?.currentPrice !== undefined && (
                <p>Valuation price: {currency} {holding.security.currentPrice}</p>
              )}
            </div>
          )}

          {(transactionType === "buy" || transactionType === "sell") && (
            <InvestmentBuySellForm
              transactionType={transactionType}
              quantity={quantity}
              onQuantityChange={setQuantity}
              price={price}
              onPriceChange={setPrice}
              fee={fee}
              onFeeChange={setFee}
              transactionDate={transactionDate}
              onTransactionDateChange={setTransactionDate}
              currentQuantity={currentQuantity.toFixed()}
              pricePlaceholder="Execution price"
              isValidSell={isValidSell}
              totalValue={trade ? Number(trade.amount) : null}
              newQuantityAfterSell={newQuantityAfterSell}
              formatCurrency={formatCurrency}
              currency={holding.security?.currency}
            />
          )}

          {(transactionType === "dividend" || transactionType === "interest") && (
            <InvestmentIncomeForm
              income={income}
              grossAmount={grossAmount}
              onGrossAmountChange={setGrossAmount}
              whtRate={whtRate}
              onWhtRateChange={setWhtRate}
              customWht={customWht}
              onCustomWhtChange={setCustomWht}
              transactionDate={transactionDate}
              onTransactionDateChange={setTransactionDate}
              formatCurrency={formatCurrency}
              currency={holding.security?.currency}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isFormValid() || isSubmitting}
            className={cn(
              transactionType === "buy" &&
                "bg-emerald-600 hover:bg-emerald-700",
              transactionType === "sell" && "bg-rose-600 hover:bg-rose-700",
              (transactionType === "dividend" ||
                transactionType === "interest") &&
                "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record {transactionType.charAt(0).toUpperCase() + transactionType.slice(1)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecordInvestmentTransactionModal;
