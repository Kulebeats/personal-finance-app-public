import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * PropertyFields - Extracted from AccountDetailsForm (TODO-029)
 * Fields specific to real estate/property accounts
 */
export interface PropertyFieldsProps {
  estimatedValue: string;
  onEstimatedValueChange: (value: string) => void;
  purchaseDate: string;
  onPurchaseDateChange: (value: string) => void;
  address: string;
  onAddressChange: (value: string) => void;
  showAddress?: boolean;
}

export function PropertyFields({
  estimatedValue,
  onEstimatedValueChange,
  purchaseDate,
  onPurchaseDateChange,
  address,
  onAddressChange,
  showAddress = true,
}: PropertyFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="value">Estimated Value</Label>
          <Input
            id="value"
            type="number"
            placeholder="0.00"
            value={estimatedValue}
            onChange={(event) => onEstimatedValueChange(event.target.value)}
            className="bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="purchased">Purchase Date</Label>
          <Input
            id="purchased"
            type="date"
            value={purchaseDate}
            onChange={(event) => onPurchaseDateChange(event.target.value)}
            className="bg-background"
          />
        </div>
      </div>
      {showAddress && (
        <div className="space-y-2">
          <Label htmlFor="address">Address (Optional)</Label>
          <Input
            id="address"
            placeholder="Property address"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            className="bg-background"
          />
        </div>
      )}
    </>
  );
}
