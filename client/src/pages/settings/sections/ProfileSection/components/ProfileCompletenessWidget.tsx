import React, { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronRight, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";

// Circular Progress Component
function CircularProgress({
  value,
  size = 32,
  strokeWidth = 3,
  className,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          className="text-muted/20"
        />
        {/* Progress Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-500 ease-out"
        />
      </svg>
    </div>
  );
}

interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  optional?: boolean;
}

/** Optional items are listed but never lower the percentage. */
export function buildProfileChecklist(formData: ProfileFormData) {
  const items: ChecklistItem[] = [
    // Core profile
    { id: "fullName", label: "Full Name", completed: !!formData.fullName },
    {
      id: "mobile",
      label: "Mobile Number",
      completed: !!formData.phoneNumberMobile,
    },
    {
      id: "occupation",
      label: "Occupation",
      completed: !!formData.occupation,
    },
    {
      id: "address",
      label: "Address",
      completed: !!formData.address?.addressLine1 && !!formData.address?.city,
    },
    {
      id: "financial",
      label: "Financial Goal",
      completed: !!formData.investmentGoal,
    },
    {
      id: "income",
      label: "Income Details",
      completed: !!formData.annualIncome,
    },
    // Phase 2: Rich profile
    {
      id: "profilePicture",
      label: "Profile Picture",
      completed: !!formData.profilePicture,
    },
    {
      id: "bio",
      label: "About Me",
      completed: !!formData.bio && formData.bio.length > 10,
    },
    {
      id: "socialLinks",
      label: "Social Links (optional)",
      optional: true,
      completed: !!(
        formData.socialLinks?.linkedin ||
        formData.socialLinks?.facebook ||
        formData.socialLinks?.twitter ||
        formData.socialLinks?.github ||
        formData.socialLinks?.website
      ),
    },
  ];

  const required = items.filter((i) => !i.optional);
  const completedCount = required.filter((i) => i.completed).length;
  const progress = Math.round((completedCount / required.length) * 100);

  return { items, progress, completedCount, total: required.length };
}

export function ProfileCompletenessWidget() {
  const { watch } = useFormContext<ProfileFormData>();
  const formData = watch();
  const checklist = useMemo(() => buildProfileChecklist(formData), [formData]);

  if (checklist.progress === 100) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-600 rounded-full text-xs font-medium border border-green-500/20">
        <Trophy className="h-3 w-3" />
        <span>Profile Complete</span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto py-1 px-2 hover:bg-accent/50 group gap-2"
        >
          <div className="flex flex-col items-end text-xs mr-1">
            <span className="font-semibold text-foreground/80 group-hover:text-primary transition-colors">
              {checklist.progress}%
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">
              Completeness
            </span>
          </div>
          <CircularProgress
            value={checklist.progress}
            className="text-primary"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 overflow-hidden">
        <div className="bg-muted/30 p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm">Profile Health</h4>
            <span className="text-xs text-muted-foreground">
              {checklist.progress}%
            </span>
          </div>

          {/* Progress Bar Visual */}
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${checklist.progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Complete your profile to unlock personalized insights.
          </p>
        </div>

        <div className="p-2">
          {checklist.items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "flex items-center justify-between p-2 rounded-md text-sm transition-colors",
                item.completed
                  ? "text-muted-foreground opacity-50"
                  : "hover:bg-accent cursor-pointer",
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "h-4 w-4 rounded-full border flex items-center justify-center",
                    item.completed
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/30",
                  )}
                >
                  {item.completed && <Check className="h-2.5 w-2.5" />}
                </div>
                <span>{item.label}</span>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
