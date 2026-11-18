import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type Goal, useBulkUpdateGoalPriority } from "@/hooks/useGoals";

type GoalPriorityModalProps = {
  open: boolean;
  onClose: () => void;
  goals: Goal[];
};

function sortByPriority(goals: Goal[]) {
  return [...goals].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.name.localeCompare(b.name);
  });
}

export function GoalPriorityModal({
  open,
  onClose,
  goals,
}: GoalPriorityModalProps) {
  const bulkUpdate = useBulkUpdateGoalPriority();
  const goalById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal])),
    [goals]
  );

  const [saveUpOrder, setSaveUpOrder] = useState<string[]>([]);
  const [payDownOrder, setPayDownOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const saveUp = sortByPriority(
      goals.filter((goal) => goal.type === "save_up")
    );
    const payDown = sortByPriority(
      goals.filter((goal) => goal.type === "pay_down")
    );
    setSaveUpOrder(saveUp.map((goal) => goal.id));
    setPayDownOrder(payDown.map((goal) => goal.id));
  }, [open, goals]);

  const moveItem = (
    list: string[],
    index: number,
    direction: "up" | "down"
  ) => {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= list.length) return list;
    const updated = [...list];
    [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
    return updated;
  };

  const buildUpdates = (order: string[]) =>
    order
      .map((id, index) => ({
        id,
        priority: index + 1,
      }))
      .filter(({ id, priority }) => {
        const goal = goalById.get(id);
        return goal && (goal.priority ?? 0) !== priority;
      });

  const handleSave = async () => {
    const updates = [
      ...buildUpdates(saveUpOrder),
      ...buildUpdates(payDownOrder),
    ];

    if (updates.length === 0) {
      onClose();
      return;
    }

    await bulkUpdate.mutateAsync(updates);
    onClose();
  };

  const renderList = (
    title: string,
    order: string[],
    setOrder: (next: string[]) => void
  ) => (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase">
        {title}
      </div>
      {order.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No goals in this section.
        </p>
      ) : (
        <div className="space-y-2">
          {order.map((id, index) => {
            const goal = goalById.get(id);
            if (!goal) return null;
            return (
              <div
                key={goal.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {goal.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Priority {index + 1}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setOrder(moveItem(order, index, "up"))}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setOrder(moveItem(order, index, "down"))}
                    disabled={index === order.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reorder goals</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6">
          {renderList("Save Up goals", saveUpOrder, setSaveUpOrder)}
          {renderList("Pay Down goals", payDownOrder, setPayDownOrder)}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={bulkUpdate.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={bulkUpdate.isPending}>
            {bulkUpdate.isPending ? "Saving..." : "Save order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
