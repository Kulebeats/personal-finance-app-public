import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { UserPreferences, UpdatePersonalPreference } from "@/hooks/use-settings";

interface ImportBehaviorCardProps {
  preferences: UserPreferences;
  onUpdate: UpdatePersonalPreference;
}

export function ImportBehaviorCard({
  preferences,
  onUpdate,
}: ImportBehaviorCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Behavior</CardTitle>
        <CardDescription>
          Settings for CSV and bulk data imports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="skip-duplicates">Skip duplicate transactions</Label>
            <p className="text-sm text-muted-foreground">
              Prevent importing transactions that match existing date and
              amount.
            </p>
          </div>
          <Switch
            id="skip-duplicates"
            checked={preferences?.skipDuplicateImports}
            onCheckedChange={(checked) =>
              onUpdate("skipDuplicateImports", checked)
            }
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-assign-rules">
              Auto-assign categories from rules
            </Label>
            <p className="text-sm text-muted-foreground">
              Apply your categorization rules automatically during import.
            </p>
          </div>
          <Switch
            id="auto-assign-rules"
            checked={preferences?.autoAssignCategoriesFromRules}
            onCheckedChange={(checked) =>
              onUpdate("autoAssignCategoriesFromRules", checked)
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
