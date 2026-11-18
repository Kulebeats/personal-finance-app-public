import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MoneyDto } from "@/lib/api";
import { toMoneyNumber } from "@/lib/money";

import type { LinkDraft, LinkType } from "./GoalTransactionLinkTypes";

type GoalTransactionLinkRowProps = {
  transaction: {
    id: string;
    name: string;
    date?: string | null;
    amount: MoneyDto;
    type: string;
    currency?: string | null;
  };
  selected: boolean;
  onToggleSelected: () => void;
  draft: LinkDraft;
  onUpdateDraft: (patch: Partial<LinkDraft>) => void;
  allowSpending: boolean;
  isAllowed: boolean;
  amountValue: string;
  formatDate: (value?: string | null) => string;
  formatCurrency: (value: number) => string;
  onLink: (linkType: LinkType, amountValue: string) => void;
  isPending: boolean;
};

export function GoalTransactionLinkRow({
  transaction,
  selected,
  onToggleSelected,
  draft,
  onUpdateDraft,
  allowSpending,
  isAllowed,
  amountValue,
  formatDate,
  formatCurrency,
  onLink,
  isPending,
}: GoalTransactionLinkRowProps) {
  const transactionAmount = Math.abs(toMoneyNumber(transaction.amount));

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Checkbox checked={selected} onCheckedChange={onToggleSelected} />
          <div>
            <div className="text-sm font-medium">{transaction.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatDate(transaction.date)}
            </div>
          </div>
        </div>
        <div className="text-sm font-semibold">
          {formatCurrency(transactionAmount)}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="grid gap-2">
          <Label>Link type</Label>
          <Select
            value={draft.linkType}
            onValueChange={(value) =>
              onUpdateDraft({
                linkType: value as LinkType,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select link type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contribution">Contribution</SelectItem>
              {allowSpending ? (
                <SelectItem value="spending">Spending</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Amount</Label>
          <Input
            type="number"
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) =>
              onUpdateDraft({
                amount: event.target.value,
              })
            }
            placeholder={transactionAmount.toFixed(2)}
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" onClick={() => onLink(draft.linkType, amountValue)} disabled={isPending || !isAllowed}>
            Link
          </Button>
        </div>
      </div>
      {!isAllowed ? (
        <p className="text-xs text-amber-600">
          This transaction cannot be linked with the selected type.
        </p>
      ) : null}
    </div>
  );
}
