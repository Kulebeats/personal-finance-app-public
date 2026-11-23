type InvestmentHoldingSummaryProps = {
  securitySymbol: string;
  securityName: string;
  currentQuantity: string;
};

export function InvestmentHoldingSummary({
  securitySymbol,
  securityName,
  currentQuantity,
}: InvestmentHoldingSummaryProps) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg">
      <div className="font-semibold">{securitySymbol}</div>
      <div className="text-sm text-muted-foreground">{securityName}</div>
      <div className="text-sm mt-1">
        <span className="text-muted-foreground">Current Holdings:</span>{" "}
        <span className="font-medium">
          {currentQuantity} shares
        </span>
      </div>
    </div>
  );
}
