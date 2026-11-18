import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, History } from "lucide-react";
import { GrzBond, useMarkGrzPaymentPaid } from "@/hooks/useGrzSecurities";
import { useFormat } from "@/hooks/use-format";
import { useAccounts } from "@/hooks/useAccounts";
import { toMoneyNumber } from "@/lib/money";
import { useState } from "react";

interface BondScheduleDialogProps {
  bond: GrzBond | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BondScheduleDialog({
  bond,
  open,
  onOpenChange,
}: BondScheduleDialogProps) {
  const { formatCurrency } = useFormat();
  const { data: accounts } = useAccounts();
  const markPaid = useMarkGrzPaymentPaid();

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [popoverOpen, setPopoverOpen] = useState<string | null>(null);

  if (!bond) return null;

  const sortedPayments = bond.payments?.sort(
    (a, b) =>
      new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
  );

  const handleMarkPaid = async (paymentId: string) => {
    if (!selectedAccountId) return;

    try {
      await markPaid.mutateAsync({
        id: paymentId,
        accountId: selectedAccountId,
      });
      setPopoverOpen(null);
      setSelectedAccountId("");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Schedule: {bond.bondName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Face Value:</span>{" "}
              {formatCurrency(toMoneyNumber(bond.faceValue))}
            </div>
            <div>
              <span className="text-muted-foreground">Coupon Rate:</span>{" "}
              {(Number(bond.couponRate) * 100).toFixed(2)}%
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">WHT</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPayments?.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>
                    {new Date(payment.paymentDate).toLocaleDateString()}
                    {payment.actualPaymentDate && (
                      <div className="text-xs text-muted-foreground">
                        Paid:{" "}
                        {new Date(
                          payment.actualPaymentDate
                        ).toLocaleDateString()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">
                    {payment.paymentType}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(toMoneyNumber(payment.grossAmount))}
                  </TableCell>
                  <TableCell className="text-right text-red-500">
                    -{formatCurrency(toMoneyNumber(payment.withholdingTax))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(toMoneyNumber(payment.netAmount))}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        payment.status === "paid" ? "default" : "outline"
                      }
                      className={
                        payment.status === "paid"
                          ? "bg-emerald-500 hover:bg-emerald-600"
                          : ""
                      }
                    >
                      {payment.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {payment.status !== "paid" && (
                      <Popover
                        open={popoverOpen === payment.id}
                        onOpenChange={(isOpen) =>
                          setPopoverOpen(isOpen ? payment.id : null)
                        }
                      >
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline">
                            Mark Paid
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="end">
                          <div className="space-y-4">
                            <h4 className="font-medium leading-none">
                              Confirm Payment
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              Select account to deposit{" "}
                              {formatCurrency(toMoneyNumber(payment.netAmount))}
                            </p>
                            <div className="grid gap-2">
                              <Label htmlFor="account">Account</Label>
                              <Select
                                value={selectedAccountId}
                                onValueChange={setSelectedAccountId}
                              >
                                <SelectTrigger id="account">
                                  <SelectValue placeholder="Select account" />
                                </SelectTrigger>
                                <SelectContent>
                                  {accounts?.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id}>
                                      {acc.name} (
                                      {formatCurrency(toMoneyNumber(acc.balance))})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              className="w-full"
                              onClick={() => handleMarkPaid(payment.id)}
                              disabled={
                                !selectedAccountId || markPaid.isPending
                              }
                            >
                              {markPaid.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              Confirm Income
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {payment.status === "paid" && (
                      <Button size="sm" variant="ghost" disabled>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!sortedPayments?.length && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground"
                  >
                    No scheduled payments found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
