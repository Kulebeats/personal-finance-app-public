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
import type { Account } from "@/lib/api";
import type { PayDownGoalType, PayoffMethod } from "@/hooks/useGoals";
import { goalFieldErrorProps, type GoalFieldErrors } from "./goalRequiredFields";

export type PayDownGoalDraft = {
  name: string;
  goalType: PayDownGoalType;
  otherGoalType: string;
  debtAccountId: string;
  interestRate: string;
  minimumPayment: string;
  monthlyPayment: string;
  oneTimePayment: string;
  payoffMethod: PayoffMethod;
  priority: number;
  notes: string;
};

const GOAL_TYPE_OPTIONS: Array<{ value: PayDownGoalType; label: string }> = [
  { value: "credit_card", label: "Credit Card" },
  { value: "student_loan", label: "Student Loan" },
  { value: "car_loan", label: "Car Loan" },
  { value: "mortgage", label: "Mortgage" },
  { value: "personal_loan", label: "Personal Loan" },
  { value: "medical_debt", label: "Medical Debt" },
  { value: "other", label: "Other" },
];

const PAYOFF_METHOD_OPTIONS: Array<{ value: PayoffMethod; label: string }> = [
  { value: "custom", label: "Custom" },
  { value: "snowball", label: "Snowball" },
  { value: "avalanche", label: "Avalanche" },
];

export function PayDownGoalForm({
  value,
  onChange,
  accounts,
  accountsLoading,
  errors = {},
}: {
  value: PayDownGoalDraft;
  onChange: (next: PayDownGoalDraft) => void;
  accounts: Account[];
  accountsLoading: boolean;
  errors?: GoalFieldErrors;
}) {
  const update = (patch: Partial<PayDownGoalDraft>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="pay-down-name">Goal name</Label>
        <Input
          id="pay-down-name"
          {...goalFieldErrorProps(errors, "pay-down-name")}
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="e.g. Visa payoff"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pay-down-debt-type">Debt type</Label>
        <Select
          value={value.goalType}
          onValueChange={(val) =>
            update({
              goalType: val as PayDownGoalType,
              otherGoalType: val === "other" ? value.otherGoalType : "",
            })
          }
        >
          <SelectTrigger id="pay-down-debt-type">
            <SelectValue placeholder="Select a debt type" />
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
          <Label htmlFor="pay-down-other-type">Please specify</Label>
          <Input
            id="pay-down-other-type"
            {...goalFieldErrorProps(errors, "pay-down-other-type")}
            value={value.otherGoalType}
            onChange={(event) => update({ otherGoalType: event.target.value })}
            placeholder="e.g. Business loan"
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="pay-down-debt-account">Debt account</Label>
        <Select
          value={value.debtAccountId}
          onValueChange={(val) => update({ debtAccountId: val })}
          disabled={accountsLoading}
        >
          <SelectTrigger id="pay-down-debt-account" {...goalFieldErrorProps(errors, "pay-down-debt-account")}>
            <SelectValue
              placeholder={
                accountsLoading ? "Loading accounts..." : "Select debt account"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="pay-down-interest">Interest rate (%)</Label>
          <Input
            id="pay-down-interest"
            {...goalFieldErrorProps(errors, "pay-down-interest")}
            type="number"
            inputMode="decimal"
            value={value.interestRate}
            onChange={(event) => update({ interestRate: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pay-down-minimum">Minimum payment</Label>
          <Input
            id="pay-down-minimum"
            {...goalFieldErrorProps(errors, "pay-down-minimum")}
            type="number"
            inputMode="decimal"
            value={value.minimumPayment}
            onChange={(event) => update({ minimumPayment: event.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="pay-down-monthly">Monthly payment</Label>
          <Input
            id="pay-down-monthly"
            {...goalFieldErrorProps(errors, "pay-down-monthly")}
            type="number"
            inputMode="decimal"
            value={value.monthlyPayment}
            onChange={(event) => update({ monthlyPayment: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pay-down-one-time">One-time payment</Label>
          <Input
            id="pay-down-one-time"
            type="number"
            inputMode="decimal"
            value={value.oneTimePayment}
            onChange={(event) => update({ oneTimePayment: event.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pay-down-payoff-method">Payoff method</Label>
        <Select
          value={value.payoffMethod}
          onValueChange={(val) => update({ payoffMethod: val as PayoffMethod })}
        >
          <SelectTrigger id="pay-down-payoff-method">
            <SelectValue placeholder="Select method" />
          </SelectTrigger>
          <SelectContent>
            {PAYOFF_METHOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pay-down-priority">Priority</Label>
        <Input
          id="pay-down-priority"
          type="number"
          value={value.priority}
          onChange={(event) =>
            update({ priority: Number(event.target.value || 0) })
          }
          min={0}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pay-down-notes">Notes</Label>
        <Textarea
          id="pay-down-notes"
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          rows={2}
        />
      </div>
    </div>
  );
}
