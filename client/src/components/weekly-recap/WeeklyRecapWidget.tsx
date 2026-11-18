import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";

interface WeeklyRecapWidgetProps {
  onOpen?: () => void;
}

export default function WeeklyRecapWidget({ onOpen }: WeeklyRecapWidgetProps) {
  return (
    <Card
      className="h-full bg-primary text-primary-foreground border-none relative overflow-hidden flex flex-col justify-between p-6"
      role="region"
      aria-labelledby="weekly-recap-title"
    >
      {/* Background patterns - decorative */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10" aria-hidden="true" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full blur-xl -ml-10 -mb-5" aria-hidden="true" />

      <div className="relative z-10 space-y-4">
        <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center" aria-hidden="true">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 id="weekly-recap-title" className="text-xl font-bold">Weekly Recap</h3>
          {/* Improved contrast: using white instead of orange-50 with opacity */}
          <p className="text-white/95 text-sm mt-1">
            Review your spending and net worth changes for this week.
          </p>
        </div>
      </div>

      <div className="relative z-10 pt-4">
        <Button
          onClick={onOpen}
          variant="secondary"
          className="w-full bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground border-0 backdrop-blur-sm justify-between group font-medium"
          aria-describedby="weekly-recap-title"
        >
          <span>View Insights</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}
