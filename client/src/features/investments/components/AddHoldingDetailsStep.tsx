import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InvestmentAccount = {
  id: string;
  name: string;
};

type AddHoldingDetailsStepProps = {
  accountId: string;
  onAccountChange: (value: string) => void;
  investmentAccounts: InvestmentAccount[];
  quantity: string;
  onQuantityChange: (value: string) => void;
  purchasePrice: string;
  onPurchasePriceChange: (value: string) => void;
  purchaseDate: string;
  onPurchaseDateChange: (value: string) => void;
  totalValue: number;
  formatCurrency: (value: number) => string;
  onBack: () => void;
  onSubmit: () => void;
  isPending: boolean;
};

export function AddHoldingDetailsStep({
  accountId,
  onAccountChange,
  investmentAccounts,
  quantity,
  onQuantityChange,
  purchasePrice,
  onPurchasePriceChange,
  purchaseDate,
  onPurchaseDateChange,
  totalValue,
  formatCurrency,
  onBack,
  onSubmit,
  isPending,
}: AddHoldingDetailsStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Investment Account *</Label>
        <Select value={accountId} onValueChange={onAccountChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select account" />
          </SelectTrigger>
          <SelectContent>
            {investmentAccounts.length > 0 ? (
              investmentAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="__none__" disabled>
                No investment accounts - create one first
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Quantity *</Label>
          <Input
            type="number"
            placeholder="100"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
            min="0"
            step="0.01"
          />
        </div>
        <div className="space-y-2">
          <Label>Purchase Price *</Label>
          <Input
            type="number"
            placeholder="15.50"
            value={purchasePrice}
            onChange={(event) => onPurchasePriceChange(event.target.value)}
            min="0"
            step="0.01"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Purchase Date</Label>
        <Input
          type="date"
          value={purchaseDate}
          onChange={(event) => onPurchaseDateChange(event.target.value)}
        />
      </div>

      {quantity && purchasePrice && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Total Cost</span>
            <span className="text-lg font-bold">
              {formatCurrency(totalValue)}
            </span>
          </div>
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!accountId || !quantity || !purchasePrice || isPending}
        >
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Add Holding
        </Button>
      </DialogFooter>
    </div>
  );
}
