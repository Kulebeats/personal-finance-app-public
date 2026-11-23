import { Loader2 } from "lucide-react";
import { useId } from "react";

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
  totalCost: string | null;
  securityCurrency: string | null;
  formatCurrency: (value: number, currency?: string) => string;
  onBack: () => void;
  onSubmit: () => void;
  isPending: boolean;
  locked: boolean;
  uncertain: boolean;
  onStartNew: () => void;
  validDate: boolean;
  validationError: string | null;
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
  totalCost,
  securityCurrency,
  formatCurrency,
  onBack,
  onSubmit,
  isPending,
  locked,
  uncertain,
  onStartNew,
  validDate,
  validationError,
}: AddHoldingDetailsStepProps) {
  const id = useId();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={id + "-account"}>Investment Account *</Label>
        <Select value={accountId} onValueChange={onAccountChange} disabled={locked}>
          <SelectTrigger id={id + "-account"}>
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
          <Label htmlFor={id + "-quantity"}>Quantity *</Label>
          <Input
            id={id + "-quantity"}
            type="number"
            placeholder="100"
            value={quantity}
            disabled={locked}
            onChange={(event) => onQuantityChange(event.target.value)}
            min="0"
            step="0.00000001"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={id + "-price"}>Purchase Price{securityCurrency ? ` (${securityCurrency})` : ""} *</Label>
          <Input
            id={id + "-price"}
            type="number"
            placeholder="15.50"
            value={purchasePrice}
            disabled={locked}
            onChange={(event) => onPurchasePriceChange(event.target.value)}
            min="0"
            step="0.0001"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id + "-date"}>Purchase Date</Label>
        <Input
          id={id + "-date"}
          type="date"
          value={purchaseDate}
          disabled={locked}
          onChange={(event) => onPurchaseDateChange(event.target.value)}
        />
      </div>

      {!securityCurrency && <p role="alert" className="text-sm text-destructive">Security denomination unavailable.</p>}
      {!validDate && <p role="alert" className="text-sm text-destructive">Enter a valid purchase date.</p>}
      {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
      {securityCurrency && quantity && purchasePrice && totalCost === null && (
        <p role="alert" className="text-sm text-destructive">Enter a nonnegative quantity with up to 8 decimal places and price with up to 4, within the supported amount limits.</p>
      )}

      {totalCost !== null && securityCurrency && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Total Cost ({securityCurrency})</span>
            <span className="text-lg font-bold">
              {formatCurrency(Number(totalCost), securityCurrency)}
            </span>
          </div>
        </div>
      )}

      {uncertain && <p role="alert" className="text-sm">The result was not confirmed. This opening may already be recorded. Retry the same opening, or start a new opening to record a separate holding.</p>}
      <DialogFooter className="gap-2 sm:gap-0">
        {uncertain && <Button variant="outline" onClick={onStartNew} disabled={isPending}>Start a new opening</Button>}
        <Button variant="outline" onClick={onBack} disabled={locked}>
          Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!accountId || totalCost === null || !securityCurrency || !validDate || isPending}
        >
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {uncertain ? "Retry same opening" : "Add Holding"}
        </Button>
      </DialogFooter>
    </div>
  );
}
