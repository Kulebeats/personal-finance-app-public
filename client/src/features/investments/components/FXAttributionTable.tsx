import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Decimal from "decimal.js";
import type { AttributionResult } from "@/hooks/useInvestments";
import { moneyValueToDecimal } from "@/lib/money";

interface FXAttributionTableProps {
  attribution: AttributionResult[];
  /** Formats an attribution amount in its unit, FX_ATTRIBUTION_CURRENCY (A-31). */
  formatAmount: (value: Decimal) => string;
}

/** Share of the absolute total gain, in whole percent (Decimal, half up). */
function shareOf(part: Decimal, total: Decimal): number {
  return part.dividedBy(total.abs()).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function FXAttributionTable({
  attribution,
  formatAmount,
}: FXAttributionTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attribution by Holding</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Total Gain</TableHead>
              <TableHead className="text-right">Asset Return</TableHead>
              <TableHead className="text-right">FX Return</TableHead>
              <TableHead className="text-right">% of Return</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attribution.map((item) => {
              const totalGain = moneyValueToDecimal(item.totalGain);
              const assetReturn = moneyValueToDecimal(item.assetReturn);
              const fxReturn = moneyValueToDecimal(item.fxReturn);
              return (
              <TableRow key={item.holdingId}>
                <TableCell className="font-medium">
                  {item.symbol}
                  <div className="text-xs text-muted-foreground">
                    {item.securityName}
                  </div>
                </TableCell>
                <TableCell>{item.currency}</TableCell>
                <TableCell
                  className={`text-right ${
                    totalGain.isNegative() ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  {formatAmount(totalGain)}
                  <div className="text-xs text-muted-foreground">
                    {item.totalReturnPercent.toFixed(1)}%
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatAmount(assetReturn)}
                </TableCell>
                <TableCell
                  className={`text-right ${
                    fxReturn.isNegative() ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  {formatAmount(fxReturn)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {!totalGain.isZero() ? (
                    <div className="flex justify-end gap-1">
                      <span className="text-blue-500" title="Asset">
                        {shareOf(assetReturn, totalGain)}
                        %
                      </span>
                      /
                      <span className="text-amber-500" title="FX">
                        {shareOf(fxReturn, totalGain)}
                        %
                      </span>
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
