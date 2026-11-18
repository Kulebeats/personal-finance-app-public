import React from "react";
import { Controller, UseFormReturn } from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FormField } from "@/features/settings/components/FormField";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";
import { DollarSign, TrendingUp, ShieldAlert, Briefcase } from "lucide-react";

interface FinancialProfileFieldsProps {
  form: UseFormReturn<ProfileFormData>;
}

export function FinancialProfileFields({ form }: FinancialProfileFieldsProps) {
  const {
    control,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-6 animate-in fade-in-50">
      {/* Employment & Income Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Controller
          name="employmentStatus"
          control={control}
          render={({ field }) => (
            <FormField
              label="Employment Status"
              error={errors.employmentStatus?.message}
              htmlFor="employmentStatus"
            >
              <div className="relative">
                <Select
                  value={field.value || "not-specified"}
                  onValueChange={(value) =>
                    field.onChange(value === "not-specified" ? "" : value)
                  }
                >
                  <SelectTrigger id="employmentStatus" className="pl-10">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not-specified">Not specified</SelectItem>
                    <SelectItem value="employed">Employed</SelectItem>
                    <SelectItem value="self-employed">Self-employed</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                    <SelectItem value="unemployed">Unemployed</SelectItem>
                    <SelectItem value="student">Student</SelectItem>
                  </SelectContent>
                </Select>
                <Briefcase className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </FormField>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <Controller
            name="annualIncome"
            control={control}
            render={({ field }) => (
              <FormField
                label="Annual Income"
                error={errors.annualIncome?.message}
                htmlFor="annualIncome"
              >
                <div className="relative">
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="0.00"
                    className="pl-8"
                    type="number"
                  />
                  <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">
                    K
                  </span>
                </div>
              </FormField>
            )}
          />

          <Controller
            name="incomeFrequency"
            control={control}
            render={({ field }) => (
              <FormField
                label="Frequency"
                error={errors.incomeFrequency?.message}
                htmlFor="incomeFrequency"
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="incomeFrequency">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        </div>
      </div>

      <div className="border-t pt-4 mt-6">
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Investment Profile
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Controller
            name="investmentGoal"
            control={control}
            render={({ field }) => (
              <FormField
                label="Primary Goal"
                error={errors.investmentGoal?.message}
                htmlFor="investmentGoal"
                hint="What are you saving for?"
              >
                <Select
                  value={field.value || ""}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger id="investmentGoal">
                    <SelectValue placeholder="Select goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retirement">Retirement</SelectItem>
                    <SelectItem value="home_purchase">Home Purchase</SelectItem>
                    <SelectItem value="wealth_growth">Wealth Growth</SelectItem>
                    <SelectItem value="education">Education</SelectItem>
                    <SelectItem value="emergency_fund">
                      Emergency Fund
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <Controller
            name="riskTolerance"
            control={control}
            render={({ field }) => (
              <FormField
                label="Risk Tolerance"
                error={errors.riskTolerance?.message}
                htmlFor="riskTolerance"
                hint="How do you handle market drops?"
              >
                <div className="relative">
                  <Select
                    value={field.value || ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id="riskTolerance" className="pl-10">
                      <SelectValue placeholder="Select risk level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">
                        Low - Preservation first
                      </SelectItem>
                      <SelectItem value="medium">
                        Medium - Balanced growth
                      </SelectItem>
                      <SelectItem value="high">
                        High - Aggressive growth
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <ShieldAlert className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                </div>
              </FormField>
            )}
          />
        </div>
      </div>
    </div>
  );
}
