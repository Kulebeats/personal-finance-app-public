import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GrzTBill } from "@/hooks/useGrzSecurities";
import { toMoneyNumber } from "@/lib/money";
import { formatDisplayDate } from "@/lib/dates";
import { TBillReceiptAction } from "./TBillReceiptForm";

const STATUS_LABELS: Partial<Record<GrzTBill["status"], string>> = { awaiting_receipt: "Awaiting receipt" };

interface GRZTBillsTableProps {
  tbills: GrzTBill[] | undefined;
  formatCurrency: (value: number, currency?: string) => string;
}

export function GRZTBillsTable({
  tbills,
  formatCurrency,
}: GRZTBillsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Treasury Bills</CardTitle>
        <CardDescription>
          Short-term government securities (Discount basis)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>T-Bill Name</TableHead>
              <TableHead>Tenor</TableHead>
              <TableHead>Yield</TableHead>
              <TableHead>Maturity</TableHead>
              <TableHead className="text-right">Face Value (ZMW)</TableHead>
              <TableHead className="text-right">Purchase Price (ZMW)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tbills?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  No T-Bills found. Click "Add Security" to record one.
                </TableCell>
              </TableRow>
            ) : (
              tbills?.map((tbill) => (
                <TableRow key={tbill.id}>
                  <TableCell className="font-medium">
                    {tbill.tbillName}
                    <div className="text-xs text-muted-foreground">
                      {tbill.isin}
                    </div>
                  </TableCell>
                  <TableCell>{tbill.tenorDays} Days</TableCell>
                  <TableCell>
                    {tbill.purchaseYield
                      ? `${(Number(tbill.purchaseYield) * 100).toFixed(2)}%`
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {formatDisplayDate(tbill.maturityDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(toMoneyNumber(tbill.faceValue), "ZMW")}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(toMoneyNumber(tbill.purchasePrice), "ZMW")}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      {STATUS_LABELS[tbill.status] ?? tbill.status}
                    </span>
                  </TableCell>
                  <TableCell><TBillReceiptAction tbill={tbill} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
