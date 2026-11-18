import { useEffect, useState } from "react";
import { useParams } from "wouter";
import Layout from "@/components/Layout";
import { useGoalsData } from "@/features/goals/hooks/useGoalsData";
import { GoalList } from "@/features/goals/components/GoalList";
import { GoalTransferModal } from "@/features/goals/components/GoalTransferModal";
import { GoalAccountsModal } from "@/features/goals/components/GoalAccountsModal";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { GoalCreationWizard } from "@/features/goals/components/GoalCreationWizard";
import { GoalDetailModal } from "@/features/goals/components/GoalDetailModal";
import { Goal } from "@/features/goals/types";
import { WidgetErrorState } from "@/components/dashboard/WidgetErrorState";
import { Skeleton } from "@/components/ui/skeleton";

// FIX P7b-2: skeleton placeholder for the goal cards GoalList renders once
// loaded, matching the loading-skeleton pattern already used elsewhere
// (e.g. Dashboard.tsx's WidgetFallback) instead of a bare "Loading..." string.
function GoalsLoadingState() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-live="polite"
      aria-label="Loading goals"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export default function Goals() {
  const { isLoading, error, refetch, saveUpGoals, payDownGoals } =
    useGoalsData();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isAccountsOpen, setIsAccountsOpen] = useState(false);

  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);

  // R12 / audit v2 P2: the `/goals/:id` route already existed in the
  // router, but this page never read the `:id` param, so links built
  // against it (dashboard GoalsWidget activity items, GoalHistoryList)
  // silently landed on the plain goals list instead of opening the goal.
  // Sync the URL param into detail-modal state so the deep link actually
  // opens the goal.
  const params = useParams<{ id?: string }>();
  useEffect(() => {
    setDetailGoalId(params.id ?? null);
  }, [params.id]);

  if (error) {
    // FIX P7b-2: was a bare error string with no retry, inconsistent with
    // sibling pages (Budget/Recurring/CashFlow). Reuse the same
    // WidgetErrorState component Reports.tsx now uses for its query-error
    // state, wired to useGoalsData's refetch.
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <WidgetErrorState
            title="Failed to load goals"
            message={
              error instanceof Error ? error.message : "Please try again later."
            }
            onRetry={() => {
              void refetch();
            }}
            className="w-full max-w-md"
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
            <p className="text-muted-foreground">
              Track your savings and pay down debt.
            </p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Goal
          </Button>
        </div>

        {isLoading ? (
          <GoalsLoadingState />
        ) : (
          <GoalList
            onGoalClick={(id) => setDetailGoalId(id)}
            onNewGoal={() => setIsCreateOpen(true)}
            onOpenTransfer={() => setIsTransferOpen(true)}
            onOpenAccounts={() => setIsAccountsOpen(true)}
          />
        )}

        <GoalCreationWizard
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
        />

        <GoalTransferModal
          open={isTransferOpen}
          onClose={() => setIsTransferOpen(false)}
        />

        <GoalAccountsModal
          open={isAccountsOpen}
          onClose={() => setIsAccountsOpen(false)}
        />

        {/* GoalDetailModal is tricky because it needs the FULL goal object.
            GoalList has the goals.
            I can find the goal from saveUpGoals/payDownGoals using detailGoalId.
        */}
        {detailGoalId && (
          <GoalDetailModalWrapper
            goalId={detailGoalId}
            onClose={() => setDetailGoalId(null)}
          />
        )}
      </div>
    </Layout>
  );
}

function GoalDetailModalWrapper({
  goalId,
  onClose,
}: {
  goalId: string;
  onClose: () => void;
}) {
  return <GoalDetailModal goalId={goalId} open={true} onClose={onClose} />;
}
