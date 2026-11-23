import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SaveUpGoalType } from "@/hooks/useGoals";
import { GoalImagePicker } from "./GoalImagePicker";
import { goalFieldErrorProps, type GoalFieldErrors } from "./goalRequiredFields";

export type SaveUpGoalDraft = {
  name: string;
  goalType: SaveUpGoalType;
  otherGoalType: string;
  icon: string;
  color: string;
  customImageUrl: string;
  targetAmount: string;
  targetDate: string;
  startDate: string;
  description: string;
  spendingReducesProgress: boolean;
  priority: number;
  notes: string;
};

const GOAL_TYPE_OPTIONS: Array<{ value: SaveUpGoalType; label: string }> = [
  { value: "vacation", label: "Vacation" },
  { value: "emergency_fund", label: "Emergency Fund" },
  { value: "down_payment", label: "Down Payment" },
  { value: "wedding", label: "Wedding" },
  { value: "vehicle", label: "Vehicle" },
  { value: "home_improvement", label: "Home Improvement" },
  { value: "special_event", label: "Special Event" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
];

const ICON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Target", label: "Target" },
  { value: "Plane", label: "Plane" },
  { value: "Home", label: "Home" },
  { value: "GraduationCap", label: "Education" },
  { value: "ShieldCheck", label: "Shield" },
  { value: "DollarSign", label: "Cash" },
];

export function SaveUpGoalForm({
  value,
  onChange,
  errors = {},
}: {
  value: SaveUpGoalDraft;
  onChange: (next: SaveUpGoalDraft) => void;
  errors?: GoalFieldErrors;
}) {
  const update = (patch: Partial<SaveUpGoalDraft>) => {
    onChange({ ...value, ...patch });
  };

  const colorPreview = /^#[0-9A-Fa-f]{6}$/.test(value.color)
    ? value.color
    : "#e5e7eb";

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="save-up-name">Goal name</Label>
        <Input
          id="save-up-name"
          {...goalFieldErrorProps(errors, "save-up-name")}
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="e.g. Family vacation"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="save-up-goal-type">Goal type</Label>
        <Select
          value={value.goalType}
          onValueChange={(val) =>
            update({
              goalType: val as SaveUpGoalType,
              otherGoalType: val === "other" ? value.otherGoalType : "",
            })
          }
        >
          <SelectTrigger id="save-up-goal-type">
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

      {value.goalType === "other" && (
        <div className="grid gap-2">
          <Label htmlFor="save-up-other-type">Please specify</Label>
          <Input
            id="save-up-other-type"
            {...goalFieldErrorProps(errors, "save-up-other-type")}
            value={value.otherGoalType}
            onChange={(event) => update({ otherGoalType: event.target.value })}
            placeholder="e.g. Investment property"
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="save-up-icon">Icon</Label>
        <Select
          value={value.icon || "none"}
          onValueChange={(val) => update({ icon: val === "none" ? "" : val })}
        >
          <SelectTrigger id="save-up-icon">
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
        <Label htmlFor="save-up-color">Accent color (hex)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="save-up-color"
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

      <div className="grid gap-2">
        <Label htmlFor="save-up-target">Target amount</Label>
        <Input
          id="save-up-target"
            {...goalFieldErrorProps(errors, "save-up-target")}
          type="number"
          inputMode="decimal"
          value={value.targetAmount}
          onChange={(event) => update({ targetAmount: event.target.value })}
          placeholder="0.00"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="save-up-target-date">Target date (optional)</Label>
        <Input
          id="save-up-target-date"
          type="date"
          value={value.targetDate}
          onChange={(event) => update({ targetDate: event.target.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="save-up-start-date">Start date (optional)</Label>
        <Input
          id="save-up-start-date"
          type="date"
          value={value.startDate}
          onChange={(event) => update({ startDate: event.target.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="save-up-description">Description</Label>
        <Textarea
          id="save-up-description"
          value={value.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="Why this goal matters"
          rows={3}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
        <div>
          <Label htmlFor="save-up-spending" className="text-sm">
            Spending reduces progress
          </Label>
          <p className="text-xs text-muted-foreground">
            Link expenses to reduce your goal balance.
          </p>
        </div>
        <Switch
          id="save-up-spending"
          checked={value.spendingReducesProgress}
          onCheckedChange={(checked) =>
            update({ spendingReducesProgress: checked })
          }
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="save-up-priority">Priority</Label>
        <Input
          id="save-up-priority"
          type="number"
          value={value.priority}
          onChange={(event) =>
            update({ priority: Number(event.target.value || 0) })
          }
          min={0}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="save-up-notes">Notes</Label>
        <Textarea
          id="save-up-notes"
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          rows={2}
        />
      </div>
    </div>
  );
}
