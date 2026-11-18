import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  parseMoneyInputNumber,
  parseMoneyString,
} from "@/lib/money";
import { cn } from "@/lib/utils";

import { InvestmentBuySellForm } from "./InvestmentBuySellForm";
import { InvestmentHoldingSummary } from "./InvestmentHoldingSummary";
import { InvestmentIncomeForm } from "./InvestmentIncomeForm";
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
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const [grossAmount, setGrossAmount] = useState("");
  const [whtRate, setWhtRate] = useState("15");
  const [customWht, setCustomWht] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { formatCurrency } = useFormat();
  const createInvestmentTransaction = useCreateInvestmentTransaction();

  const currentQuantity = Number(holding.quantity || "0");
  const currentPrice =
    parseMoneyInputNumber(holding.security?.currentPrice) ?? 0;
  const securitySymbol = holding.security?.symbol || "N/A";
  const securityName = holding.security?.name || "Unknown Security";

  useEffect(() => {
    if (open) {
      setTransactionType("buy");
      setQuantity("");
      setPrice(currentPrice.toString());
      setTransactionDate(new Date().toISOString().split("T")[0]);
      setGrossAmount("");
      setWhtRate("15");
      setCustomWht(false);
    }
  }, [open, currentPrice]);

  const qtyDecimal = parseMoneyInputDecimal(quantity) ?? parseMoneyString(0);
  const priceDecimal = parseMoneyInputDecimal(price) ?? parseMoneyString(0);
  const grossDecimal =
    parseMoneyInputDecimal(grossAmount) ?? parseMoneyString(0);
  const whtDecimal = (
    parseMoneyInputDecimal(whtRate) ?? parseMoneyString(0)
  ).dividedBy(100);

  const qty = qtyDecimal.toNumber();
  const prc = priceDecimal.toNumber();
  const gross = grossDecimal.toNumber();
  const totalValueDecimal = qtyDecimal.times(priceDecimal);
  const whtAmountDecimal = grossDecimal.times(whtDecimal);
  const netAmountDecimal = grossDecimal.minus(whtAmountDecimal);
  const totalValue = totalValueDecimal.toNumber();
  const whtAmount = whtAmountDecimal.toNumber();
  const netAmount = netAmountDecimal.toNumber();

  const isValidSell =
    transactionType === "sell" ? qty <= currentQuantity : true;
  const newQuantityAfterSell = currentQuantity - qty;

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const currency = holding.security?.currency || "ZMW";
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
          ? {
              ...basePayload,
              quantity: qtyDecimal.toString(),
              price: priceDecimal.toFixed(2),
              amount: totalValueDecimal.toFixed(2),
            }
          : {
              ...basePayload,
              amount: netAmountDecimal.toFixed(2),
              withholdingTax: whtAmountDecimal.toFixed(2),
            };

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
      return qty > 0 && prc > 0 && isValidSell;
    }
    if (transactionType === "dividend" || transactionType === "interest") {
      return gross > 0;
    }
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-orange-500" />
            Record Transaction
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <InvestmentHoldingSummary
            securitySymbol={securitySymbol}
            securityName={securityName}
            currentQuantity={currentQuantity}
          />

          <div className="space-y-2">
            <Label>Transaction Type</Label>
            <InvestmentTransactionTypeSelector
              transactionType={transactionType}
              onChange={setTransactionType}
            />
          </div>

          {(transactionType === "buy" || transactionType === "sell") && (
            <InvestmentBuySellForm
              transactionType={transactionType}
              quantity={quantity}
              onQuantityChange={setQuantity}
              price={price}
              onPriceChange={setPrice}
              transactionDate={transactionDate}
              onTransactionDateChange={setTransactionDate}
              currentQuantity={currentQuantity}
              pricePlaceholder={currentPrice.toString()}
              isValidSell={isValidSell}
              totalValue={totalValue}
              newQuantityAfterSell={newQuantityAfterSell}
              formatCurrency={formatCurrency}
              currency={holding.security?.currency}
            />
          )}

          {(transactionType === "dividend" || transactionType === "interest") && (
            <InvestmentIncomeForm
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
