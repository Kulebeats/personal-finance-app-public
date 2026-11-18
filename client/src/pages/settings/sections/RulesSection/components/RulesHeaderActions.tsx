import React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Wand2 } from "lucide-react";

type RulesHeaderActionsProps = {
  isCreating: boolean;
  onOpenEditor: () => void;
  onStartQuick: () => void;
};

export function RulesHeaderActions({
  isCreating,
  onOpenEditor,
  onStartQuick,
}: RulesHeaderActionsProps) {
  return (
    <div className="flex gap-2">
      <Button onClick={onOpenEditor} size="sm" className="bg-rose-400 hover:bg-rose-500">
        <Wand2 className="w-4 h-4 mr-2" />
        New Rule (Editor)
      </Button>
      {!isCreating && (
        <Button onClick={onStartQuick} size="sm" variant="outline">
          <Plus className="w-4 h-4 mr-2" />
          Quick Rule
        </Button>
      )}
    </div>
  );
}
