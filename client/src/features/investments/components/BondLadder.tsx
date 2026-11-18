import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGrzBonds, GrzBond, GrzBondPayment } from "@/hooks/useGrzSecurities";
import { useFormat } from "@/hooks/use-format";
import { toMoneyNumber } from "@/lib/money";
import { format, isAfter, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";

export function BondLadder() {
  const { data: bonds } = useGrzBonds();
  const { formatCurrency } = useFormat();

  if (!bonds) return null;

  // Flatten all payments
  const allPayments = bonds.flatMap((bond) =>
    (bond.payments || []).map((p) => ({
      ...p,
      bondName: bond.bondName,
      bondIsin: bond.isin,
    }))
  );

  // Filter pending and sort by date
  // Note: paymentDate is string ISO
  const upcomingPayments = allPayments
    .filter((p) => p.status === "scheduled")
    .sort(
      (a, b) =>
        new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
    );

  // Get next 12 months (or just next 10 payments)
  const nextPayments = upcomingPayments.slice(0, 10);

  // Group by Month for Summary?
  // Let's just list them for now as a "Ladder" of cashflows.

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bond Payment Ladder</CardTitle>
        <CardDescription>
          Upcoming coupon and principal payments across your portfolio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {nextPayments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No upcoming payments found.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Bond</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount (Net)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nextPayments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {format(parseISO(p.paymentDate), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{p.bondName}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.bondIsin}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        p.paymentType === "principal" ? "default" : "outline"
                      }
                    >
                      {p.paymentType.charAt(0).toUpperCase() +
                        p.paymentType.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(toMoneyNumber(p.netAmount))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
