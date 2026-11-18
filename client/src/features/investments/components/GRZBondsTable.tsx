import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import type { GrzBond } from "@/hooks/useGrzSecurities";
import { toMoneyNumber } from "@/lib/money";

interface GRZBondsTableProps {
  bonds: GrzBond[] | undefined;
  formatCurrency: (value: number, currency?: string) => string;
  onViewSchedule: (bond: GrzBond) => void;
}

export function GRZBondsTable({
  bonds,
  formatCurrency,
  onViewSchedule,
}: GRZBondsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Government Bonds (GRZ)</CardTitle>
        <CardDescription>
          Long-term debt securities issued by the Bank of Zambia
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bond Name</TableHead>
              <TableHead>Tenor</TableHead>
              <TableHead>Coupon</TableHead>
              <TableHead>Maturity</TableHead>
              <TableHead className="text-right">Face Value</TableHead>
              <TableHead className="text-right">Purchase Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bonds?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  No bonds found. Click "Add Security" to record one.
                </TableCell>
              </TableRow>
            ) : (
              bonds?.map((bond) => (
                <TableRow key={bond.id}>
                  <TableCell className="font-medium">
                    {bond.bondName}
                    <div className="text-xs text-muted-foreground">
                      {bond.isin}
                    </div>
                  </TableCell>
                  <TableCell>{bond.tenorYears} Years</TableCell>
                  <TableCell>
                    {(Number(bond.couponRate) * 100).toFixed(2)}%
                  </TableCell>
                  <TableCell>
                    {new Date(bond.maturityDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(toMoneyNumber(bond.faceValue))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(toMoneyNumber(bond.purchasePrice))}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      {bond.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewSchedule(bond)}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      Schedule
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
