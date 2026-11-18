import React, { createContext, useContext, useState, useEffect } from "react";
import {
  useWeeklyRecapData,
  WeeklyRecapData,
} from "./hooks/useWeeklyRecapData";
import { useWeeklyRecapFeedback } from "./hooks/useWeeklyRecapData";
import type { WeeklyRecapStep, WeeklyRecapFeedbackStep } from "@shared/weekly-recap";
import { useSettings } from "@/contexts/SettingsContext";

// Re-export the step type with the local name for backward compatibility
export type RecapStep = WeeklyRecapStep;

interface WeeklyRecapContextType {
  data: WeeklyRecapData | undefined;
  isLoading: boolean;
  currentStep: RecapStep;
  stepIndex: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  submitStepFeedback: (feedback: "positive" | "negative") => void;
  close: () => void;
}

const WeeklyRecapContext = createContext<WeeklyRecapContextType | undefined>(
  undefined
);

const STEPS: RecapStep[] = [
  "welcome",
  "net-worth",
  "spending",
  "recurring",
  "goals",
  "wrap-up",
];

export function WeeklyRecapProvider({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { data, isLoading } = useWeeklyRecapData();
  const { mutate: submitFeedback } = useWeeklyRecapFeedback();

  const [currentStep, setCurrentStep] = useState<RecapStep>("welcome");

  const stepIndex = STEPS.indexOf(currentStep);
  const totalSteps = STEPS.length;

  const nextStep = () => {
    if (stepIndex < totalSteps - 1) {
      setCurrentStep(STEPS[stepIndex + 1]);
    } else {
      onClose();
    }
  };

  const prevStep = () => {
    if (stepIndex > 0) {
      setCurrentStep(STEPS[stepIndex - 1]);
    }
  };

  const settings = useSettings();

  const submitStepFeedback = (feedback: "positive" | "negative") => {
    // Calculate current week dates as fallback, respecting user's first day of week
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // Convert user's firstDayOfWeek setting to day number (0-6)
    const firstDayMap: Record<string, number> = {
      "Sunday": 0,
      "Monday": 1,
      "Tuesday": 2,
      "Wednesday": 3,
      "Thursday": 4,
      "Friday": 5,
      "Saturday": 6,
    };
    const userFirstDay = firstDayMap[settings.firstDayOfWeek] ?? 0;

    // Calculate offset to get to the start of the week
    let offset = dayOfWeek - userFirstDay;
    if (offset < 0) offset += 7;

    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() - offset);
    weekStartDate.setHours(0, 0, 0, 0);

    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    const weekStart = data?.weekStart ?? formatDate(weekStartDate);
    const weekEnd = data?.weekEnd ?? formatDate(weekEndDate);

    // The server accepts both "wrap-up" and "overall" for the final step
    // Since WeeklyRecapFeedbackStep includes both values, we can pass directly
    // Note: "welcome" step doesn't need feedback, but we'll still send it
    const step = currentStep as WeeklyRecapFeedbackStep;
    submitFeedback({ step, feedback, weekStart, weekEnd });
  };

  return (
    <WeeklyRecapContext.Provider
      value={{
        data,
        isLoading,
        currentStep,
        stepIndex,
        totalSteps,
        nextStep,
        prevStep,
        submitStepFeedback,
        close: onClose,
      }}
    >
      {children}
    </WeeklyRecapContext.Provider>
  );
}

export function useWeeklyRecap() {
  const context = useContext(WeeklyRecapContext);
  if (context === undefined) {
    throw new Error("useWeeklyRecap must be used within a WeeklyRecapProvider");
  }
  return context;
}
