import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GoalImagePicker } from "./GoalImagePicker";
import { goalFieldErrorProps, type GoalFieldErrors } from "./goalRequiredFields";

// Custom types for Investment
export type InvestmentGoalType =
  | "retirement"
  | "wealth_building"
  | "education"
  | "property"
  | "other";

export type InvestmentGoalDraft = {
  name: string;
  goalType: InvestmentGoalType;
  otherGoalType: string;
  icon: string;
  color: string;
  customImageUrl: string;
  targetAmount: string;
  targetDate: string;
  startDate: string;
  linkedAccountId: string;
  expectedReturn: string;
  inflationRate: string;
  description: string;
  priority: number;
  notes: string;
};

const GOAL_TYPE_OPTIONS: Array<{ value: InvestmentGoalType; label: string }> = [
  { value: "retirement", label: "Retirement" },
  { value: "wealth_building", label: "Wealth Building" },
  { value: "education", label: "Education" },
  { value: "property", label: "Property" },
  { value: "other", label: "Other" },
];

const ICON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "TrendingUp", label: "Growth" },
  { value: "Landmark", label: "Bank" },
  { value: "Coins", label: "Coins" },
  { value: "Briefcase", label: "Work" },
  { value: "GraduationCap", label: "Education" },
  { value: "Home", label: "Property" },
  { value: "DollarSign", label: "Cash" },
];

export function InvestmentGoalForm({
  value,
  onChange,
  accounts,
  errors = {},
}: {
  value: InvestmentGoalDraft;
  onChange: (next: InvestmentGoalDraft) => void;
  accounts: Array<{ id: string; name: string }>;
  errors?: GoalFieldErrors;
}) {
  const update = (patch: Partial<InvestmentGoalDraft>) => {
    onChange({ ...value, ...patch });
  };

  const colorPreview = /^#[0-9A-Fa-f]{6}$/.test(value.color)
    ? value.color
    : "#e5e7eb";

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="inv-name">Goal name</Label>
        <Input
          id="inv-name"
          {...goalFieldErrorProps(errors, "inv-name")}
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="e.g. Early Retirement"
        />
      </div>

      <div className="grid gap-2">
        <Label>Goal type</Label>
        <Select
          value={value.goalType}
          onValueChange={(val) =>
            update({
              goalType: val as InvestmentGoalType,
              otherGoalType: val === "other" ? value.otherGoalType : "",
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a goal type" />
          </SelectTrigger>
          <SelectContent>
            {GOAL_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Linked investment account (optional)</Label>
        <Select
          value={value.linkedAccountId || "none"}
          onValueChange={(val) =>
            update({ linkedAccountId: val === "none" ? "" : val })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No linked account</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.goalType === "other" && (
        <div className="grid gap-2">
          <Label htmlFor="inv-other-type">Please specify</Label>
          <Input
            id="inv-other-type"
            {...goalFieldErrorProps(errors, "inv-other-type")}
            value={value.otherGoalType}
            onChange={(event) => update({ otherGoalType: event.target.value })}
            placeholder="e.g. Art Collection"
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label>Icon</Label>
        <Select
          value={value.icon || "none"}
          onValueChange={(val) => update({ icon: val === "none" ? "" : val })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an icon" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No icon</SelectItem>
            {ICON_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="inv-color">Accent color (hex)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="inv-color"
            value={value.color}
            onChange={(event) => update({ color: event.target.value })}
            placeholder="#22c55e"
          />
          <div
            className="h-8 w-8 rounded-md border"
            style={{ backgroundColor: colorPreview }}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Goal image</Label>
        <GoalImagePicker
          value={value.customImageUrl}
          onChange={(url) => update({ customImageUrl: url })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="inv-target">Target amount</Label>
          <Input
            id="inv-target"
            {...goalFieldErrorProps(errors, "inv-target")}
            type="number"
            inputMode="decimal"
            value={value.targetAmount}
            onChange={(event) => update({ targetAmount: event.target.value })}
            placeholder="0.00"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="inv-target-date">Target date</Label>
          <Input
            id="inv-target-date"
            type="date"
            value={value.targetDate}
            onChange={(event) => update({ targetDate: event.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="inv-return">Expected Return (%)</Label>
          <Input
            id="inv-return"
            type="number"
            inputMode="decimal"
            value={value.expectedReturn}
            onChange={(event) => update({ expectedReturn: event.target.value })}
            placeholder="8.0"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="inv-inflation">Inflation Rate (%)</Label>
          <Input
            id="inv-inflation"
            type="number"
            inputMode="decimal"
            value={value.inflationRate}
            onChange={(event) => update({ inflationRate: event.target.value })}
            placeholder="3.0"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="inv-start-date">Start date (optional)</Label>
        <Input
          id="inv-start-date"
          type="date"
          value={value.startDate}
          onChange={(event) => update({ startDate: event.target.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="inv-description">Description</Label>
        <Textarea
          id="inv-description"
          value={value.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="Investment strategy summary"
          rows={3}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="inv-priority">Priority</Label>
        <Input
          id="inv-priority"
          type="number"
          value={value.priority}
          onChange={(event) =>
            update({ priority: Number(event.target.value || 0) })
          }
          min={0}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="inv-notes">Notes</Label>
        <Textarea
          id="inv-notes"
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          rows={2}
        />
      </div>
    </div>
  );
}
