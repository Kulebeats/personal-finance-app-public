import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  WeeklyRecapProvider,
  useWeeklyRecap,
  RecapStep,
} from "./WeeklyRecapContext";
import StepProgress from "./components/StepProgress";
import WelcomeStep from "./steps/WelcomeStep";
import NetWorthStep from "./steps/NetWorthStep";
import SpendingStep from "./steps/SpendingStep";
import RecurringStep from "./steps/RecurringStep";
import GoalsStep from "./steps/GoalsStep";
import WrapUpStep from "./steps/WrapUpStep";
import { Loader2, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WeeklyRecapWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function WizardContent() {
  const { currentStep, isLoading, isChecking, error, retry, close, prevStep, stepIndex } = useWeeklyRecap();

  if (isLoading || isChecking) {
    return (
      <div className="h-[400px] flex items-center justify-center" role="status" aria-label="Loading weekly recap">
        <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
        <span>Checking current access to your weekly financial summary…</span>
      </div>
    );
  }

  if (error) return <div role="alert" className="p-6 space-y-4">
    <p>Unable to refresh your weekly recap. Please try again.</p>
    <Button onClick={retry}>Retry</Button>
    <Button variant="outline" onClick={close}>Close</Button>
  </div>;

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return <WelcomeStep />;
      case "net-worth":
        return <NetWorthStep />;
      case "spending":
        return <SpendingStep />;
      case "recurring":
        return <RecurringStep />;
      case "goals":
        return <GoalsStep />;
      case "wrap-up":
        return <WrapUpStep />;
      default:
        return null;
    }
  };

  return (
    <div className="relative h-full flex flex-col min-h-0">
      {stepIndex > 0 && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-0 top-0 z-10"
          onClick={prevStep}
          aria-label="Go back to previous step"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 z-10"
        onClick={close}
        aria-label="Close weekly recap"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </Button>

      {currentStep !== "welcome" && currentStep !== "wrap-up" && (
        <StepProgress />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-4 pb-6">
        <div
          key={currentStep}
          className="min-h-full pb-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
        >
          {renderStep()}
        </div>
      </div>
    </div>
  );
}

export default function WeeklyRecapWizard({
  open,
  onOpenChange,
}: WeeklyRecapWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md h-[600px] p-6 overflow-hidden bg-background/95 backdrop-blur-xl border-primary/20">
        <VisuallyHidden.Root>
          <DialogTitle>Weekly Recap</DialogTitle>
          <DialogDescription>Your weekly financial check-in</DialogDescription>
        </VisuallyHidden.Root>
        <WeeklyRecapProvider onClose={() => onOpenChange(false)}>
          <WizardContent />
        </WeeklyRecapProvider>
      </DialogContent>
    </Dialog>
  );
}
