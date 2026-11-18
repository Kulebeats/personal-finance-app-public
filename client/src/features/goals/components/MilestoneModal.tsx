import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GoalProgressBar } from "./GoalProgressBar";
import { useFormatters } from "@/contexts/SettingsContext";
import { Trophy, Star, Sparkles, Target, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MilestoneModalProps {
  open: boolean;
  onClose: () => void;
  goalName: string;
  milestone: number;
  currentAmount: number;
  targetAmount: number;
  color?: string | null;
  isCompleted?: boolean;
}

const MILESTONE_CONFIG: Record<
  number,
  { icon: React.ComponentType<{ className?: string }>; title: string; message: string }
> = {
  25: {
    icon: Star,
    title: "Great Start!",
    message: "You've reached 25% of your goal. Keep the momentum going!",
  },
  50: {
    icon: Target,
    title: "Halfway There!",
    message: "Amazing! You're halfway to your goal. You're doing great!",
  },
  75: {
    icon: Sparkles,
    title: "Almost There!",
    message: "Just 25% more to go! The finish line is in sight!",
  },
  100: {
    icon: Trophy,
    title: "Goal Achieved!",
    message: "Congratulations! You've reached your goal!",
  },
};

export function MilestoneModal({
  open,
  onClose,
  goalName,
  milestone,
  currentAmount,
  targetAmount,
  color,
  isCompleted = false,
}: MilestoneModalProps) {
  const { formatCurrency } = useFormatters();
  const [showConfetti, setShowConfetti] = useState(false);

  const config = MILESTONE_CONFIG[milestone] ?? MILESTONE_CONFIG[100];
  const Icon = config.icon;

  useEffect(() => {
    if (open) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const progress = Math.min(100, Math.round((currentAmount / targetAmount) * 100));

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-md text-center">
          <div className="flex flex-col items-center pt-4">
            <div
              className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center mb-4",
                milestone === 100
                  ? "bg-gradient-to-br from-amber-400 to-amber-600"
                  : "bg-gradient-to-br from-emerald-400 to-emerald-600"
              )}
            >
              <Icon className="w-10 h-10 text-white" />
            </div>

            <DialogHeader className="text-center">
              <DialogTitle className="text-2xl font-bold">
                {isCompleted ? "Goal Completed!" : config.title}
              </DialogTitle>
              <DialogDescription className="text-base mt-2">
                {config.message}
              </DialogDescription>
            </DialogHeader>

            <div className="w-full mt-6 p-4 bg-muted/50 rounded-lg">
              <h3 className="font-semibold text-lg mb-1">{goalName}</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-bold text-lg">{progress}%</span>
                </div>
                <GoalProgressBar
                  current={currentAmount}
                  target={targetAmount}
                  color={color}
                />
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{formatCurrency(currentAmount)}</span>
                  <span>of {formatCurrency(targetAmount)}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 w-full">
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Continue
              </Button>
              {milestone === 100 && (
                <Button
                  className="flex-1 gap-2"
                  style={{ backgroundColor: color ?? undefined }}
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
  );
}

// Hook to manage milestone notifications
interface MilestoneData {
  goalName: string;
  milestone: number;
  currentAmount: number;
  targetAmount: number;
  color?: string | null;
  isCompleted?: boolean;
}

export function useMilestoneModal() {
  const [milestoneState, setMilestoneState] = useState<(MilestoneData & { open: boolean }) | null>(null);

  const showMilestone = (data: MilestoneData) => {
    setMilestoneState({ ...data, open: true });
  };

  const closeMilestone = () => {
    setMilestoneState(null);
  };

  const MilestoneModalComponent = milestoneState ? (
    <MilestoneModal
      open={milestoneState.open}
      onClose={closeMilestone}
      goalName={milestoneState.goalName}
      milestone={milestoneState.milestone}
      currentAmount={milestoneState.currentAmount}
      targetAmount={milestoneState.targetAmount}
      color={milestoneState.color}
      isCompleted={milestoneState.isCompleted}
    />
  ) : null;

  return { showMilestone, closeMilestone, MilestoneModalComponent };
}
