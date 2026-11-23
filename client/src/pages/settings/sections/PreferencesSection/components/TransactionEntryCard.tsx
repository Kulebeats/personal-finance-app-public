import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { UserPreferences, UpdatePersonalPreference } from "@/hooks/use-settings";

interface TransactionEntryCardProps {
  preferences: UserPreferences;
  onUpdate: UpdatePersonalPreference;
}

export function TransactionEntryCard({
  preferences,
  onUpdate,
}: TransactionEntryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction Entry</CardTitle>
        <CardDescription>
          Defaults to speed up manual transaction entry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="remember-account">Remember last used account</Label>
            <p className="text-sm text-muted-foreground">
              Auto-select the account you used last time.
            </p>
          </div>
          <Switch
            id="remember-account"
            checked={preferences?.rememberLastAccount}
            onCheckedChange={(checked) =>
              onUpdate("rememberLastAccount", checked)
            }
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="remember-category">
              Remember category per merchant
            </Label>
            <p className="text-sm text-muted-foreground">
              Suggest the last used category for a specific merchant.
            </p>
          </div>
          <Switch
            id="remember-category"
            checked={preferences?.rememberLastCategoryPerMerchant}
            onCheckedChange={(checked) =>
              onUpdate("rememberLastCategoryPerMerchant", checked)
            }
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-date">Auto-fill today's date</Label>
            <p className="text-sm text-muted-foreground">
              Set the date to today by default for new transactions.
            </p>
          </div>
          <Switch
            id="auto-date"
            checked={preferences?.autoFillTodayDate}
            onCheckedChange={(checked) =>
              onUpdate("autoFillTodayDate", checked)
            }
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="default-type">Default Transaction Type</Label>
            <p className="text-sm text-muted-foreground">
              The initial type selected when adding a transaction.
            </p>
          </div>
          <Select
            value={preferences?.defaultTransactionType}
            onValueChange={(value) => { if (value === "expense" || value === "income" || value === "transfer") onUpdate("defaultTransactionType", value); }}
          >
            <SelectTrigger className="w-[180px]" id="default-type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
