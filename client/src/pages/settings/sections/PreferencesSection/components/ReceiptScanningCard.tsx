import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { UserPreferences } from "@/hooks/use-settings";

interface ReceiptScanningCardProps {
  preferences?: UserPreferences;
  onUpdate: (
    key: keyof UserPreferences,
    value: UserPreferences[keyof UserPreferences]
  ) => void;
}

export function ReceiptScanningCard({
  preferences,
  onUpdate,
}: ReceiptScanningCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receipt Scanning</CardTitle>
        <CardDescription>
          Configuration for OCR and receipt processing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-create-receipt">
              Auto-create transactions
            </Label>
            <p className="text-sm text-muted-foreground">
              Automatically create a transaction when a receipt is scanned
              successfully.
            </p>
          </div>
          <Switch
            id="auto-create-receipt"
            checked={preferences?.autoCreateFromReceipt}
            onCheckedChange={(checked) =>
              onUpdate("autoCreateFromReceipt", checked)
            }
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="require-ocr-review">Require manual review</Label>
            <p className="text-sm text-muted-foreground">
              Always ask for confirmation before saving scanned data.
            </p>
          </div>
          <Switch
            id="require-ocr-review"
            checked={preferences?.requireOcrReview}
            onCheckedChange={(checked) => onUpdate("requireOcrReview", checked)}
          />
        </div>
        <Separator />
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ocr-threshold">OCR Confidence Threshold</Label>
            <span className="text-sm font-medium">
              {preferences?.ocrConfidenceThreshold}%
            </span>
          </div>
          <Slider
            id="ocr-threshold"
            min={50}
            max={95}
            step={5}
            value={[preferences?.ocrConfidenceThreshold || 70]}
            onValueChange={(value) =>
              onUpdate("ocrConfidenceThreshold", value[0])
            }
          />
          <p className="text-sm text-muted-foreground">
            Minimum confidence score required to accept scanned text
            automatically.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
