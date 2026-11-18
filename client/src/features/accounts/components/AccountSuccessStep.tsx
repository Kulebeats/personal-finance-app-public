import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";

type AccountSuccessStepProps = {
  onAddAnother: () => void;
};

export function AccountSuccessStep({ onAddAnother }: AccountSuccessStepProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center animate-in zoom-in-95 duration-300">
      <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-4">
        <CheckCircle2 className="w-8 h-8" />
      </div>
      <h3 className="text-xl font-bold text-foreground mb-2">
        Account Added Successfully!
      </h3>
      <p className="text-muted-foreground max-w-xs mb-8">
        Your account has been created. You can now track its balance and
        transactions.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button onClick={onAddAnother} variant="outline">
          Add Another Account
        </Button>
        <DialogTrigger asChild>
          <Button>Done</Button>
        </DialogTrigger>
      </div>
    </div>
  );
}
