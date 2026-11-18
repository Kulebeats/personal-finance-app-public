import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AttributionResult } from "@/hooks/useInvestments";

interface FXAttributionTableProps {
  attribution: AttributionResult[];
  formatCurrency: (value: number, currency?: string) => string;
}

export function FXAttributionTable({
  attribution,
  formatCurrency,
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
            {attribution.map((item) => (
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
                    item.totalGain >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {formatCurrency(item.totalGain)}
                  <div className="text-xs text-muted-foreground">
                    {item.totalReturnPercent.toFixed(1)}%
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(item.assetReturn)}
                </TableCell>
                <TableCell
                  className={`text-right ${
                    item.fxReturn >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {formatCurrency(item.fxReturn)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {Math.abs(item.totalGain) > 0 ? (
                    <div className="flex justify-end gap-1">
                      <span className="text-blue-500" title="Asset">
                        {Math.round(
                          (item.assetReturn / Math.abs(item.totalGain)) * 100
                        )}
                        %
                      </span>
                      /
                      <span className="text-amber-500" title="FX">
                        {Math.round(
                          (item.fxReturn / Math.abs(item.totalGain)) * 100
                        )}
                        %
                      </span>
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
