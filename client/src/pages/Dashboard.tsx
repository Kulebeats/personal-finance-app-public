import Layout from "@/components/Layout";
import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import { GettingStartedChecklist } from "@/components/dashboard/GettingStartedChecklist";
import { lazy, Suspense, useState, type ElementType } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { SlidersHorizontal } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Widgets
import RecentTransactionsWidget from "@/components/dashboard/RecentTransactionsWidget";
import AccountsWidget from "@/components/dashboard/AccountsWidget";
import BudgetStatusWidget from "@/components/dashboard/BudgetStatusWidget";
import GoalsWidget from "@/components/dashboard/GoalsWidget";
import RecurringExpensesWidget from "@/components/dashboard/RecurringExpensesWidget";
import AnnualSummaryWidget from "@/components/dashboard/AnnualSummaryWidget";
import DashboardBudgetWidget from "@/components/dashboard/DashboardBudgetWidget";
import DashboardTransactionsWidget from "@/components/dashboard/DashboardTransactionsWidget";
import TopMerchantsWidget from "@/components/dashboard/TopMerchantsWidget";
import InvestmentSummaryWidget from "@/components/dashboard/InvestmentSummaryWidget";

// ... imports
import WeeklyRecapWidget from "@/components/weekly-recap/WeeklyRecapWidget";

import {
  CustomizeDashboardModal,
  WidgetConfig,
} from "@/components/dashboard/CustomizeDashboardModal";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { AddAccountModal } from "@/features/accounts";
import { useFormat } from "@/hooks/use-format";
import { useProfile } from "@/hooks/use-settings";
import { useDashboardWidgets } from "@/hooks/useDashboardWidgets";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { Skeleton } from "@/components/ui/skeleton";

const NetWorthWidget = lazy(() => import("@/components/dashboard/NetWorthWidget"));
const CashFlowWidget = lazy(() => import("@/components/dashboard/CashFlowWidget"));
const SpendingWidget = lazy(() => import("@/components/dashboard/SpendingWidget"));
const DashboardSpendingWidget = lazy(
  () => import("@/components/dashboard/DashboardSpendingWidget")
);
const WeeklyRecapWizard = lazy(
  () => import("@/components/weekly-recap/WeeklyRecapWizard")
);

function WidgetFallback() {
  return (
    <Card className="h-full w-full border-border/50 bg-card shadow-sm">
      <CardContent className="flex h-full flex-col justify-center gap-4 p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

// Map component IDs to actual components
const WIDGET_COMPONENTS: Record<string, ElementType<{ onOpen?: () => void }>> = {
  "weekly-recap": WeeklyRecapWidget, // Add this
  "budget-summary": DashboardBudgetWidget,
  "transactions-list": DashboardTransactionsWidget,
  "spending-trend": DashboardSpendingWidget,
  "top-merchants": TopMerchantsWidget,
  "net-worth": NetWorthWidget,
  "annual-summary": AnnualSummaryWidget,
  "recent-transactions": RecentTransactionsWidget,
  "cash-flow": CashFlowWidget,
  recurring: RecurringExpensesWidget,
  "spending-category": SpendingWidget,
  accounts: AccountsWidget,
  goals: GoalsWidget,
  "budget-status": BudgetStatusWidget,
  investments: InvestmentSummaryWidget,
};

// Sortable Item Wrapper
function SortableWidget({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("h-full relative group", className)}
    >
      {/* Drag Handle overlay only appears on hover if needed, but sticking to whole item drag for now or header drag */}
      <div {...attributes} {...listeners} className="h-full">
        {children}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: userProfile } = useProfile();
  const { formatCurrency } = useFormat();

  const {
    widgets,
    toggleWidget,
    reorderWidgets,
    isLoading: widgetsLoading,
    saveStatus,
    saveError,
    retrySave,
    loadError,
    retryLoad,
  } = useDashboardWidgets();

  // Auto-refresh dashboard data when user returns to tab after 1 minute
  useRefetchOnFocus({
    queryKeys: [
      ["reports"],
      ["transactions"],
      ["budgets"],
      ["goals"],
      ["accounts"],
      ["investments"],
    ],
    staleTime: 60000, // 1 minute
  });

  const [customizing, setCustomizing] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false); // State for wizard

  // Default sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require movement of 8px before drag starts to prevent accidental clicks
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // Create new sorted array for immediate visual feedback if needed,
      // but the hook handles the state update and save
      reorderWidgets(active.id as string, over.id as string);
    }
  };

  const visibleWidgets = widgets.filter((w) => w.enabled);

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Dashboard
          </h1>
          <DashboardGreeting name={userProfile?.firstName?.trim() || userProfile?.displayName?.trim() || userProfile?.fullName?.trim().split(/\s+/)[0]} />
        </div>
        <div className="flex flex-wrap gap-3">
          <AddAccountModal>
            <Button type="button">
              <Plus className="w-4 h-4" /> Add Account
            </Button>
          </AddAccountModal>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCustomizing(true)}
            disabled={widgetsLoading || !!loadError}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Customize
          </Button>
        </div>
      </div>

      <GettingStartedChecklist />

      {loadError && (
        <div className="mb-4 flex items-center gap-3">
          <p role="alert">Dashboard layout could not be loaded. {loadError}</p>
          <Button variant="outline" onClick={retryLoad} disabled={widgetsLoading}>Retry Loading Layout</Button>
        </div>
      )}

      {!widgetsLoading && saveStatus && saveStatus !== "idle" && (
        <div className="mb-4 flex items-center gap-3">
          {saveStatus === "error" ? (
            <>
              <p role="alert">Dashboard layout is not saved. {saveError}</p>
              <Button variant="outline" onClick={retrySave}>Retry Save</Button>
            </>
          ) : (
            <p role="status" aria-live="polite">
              {saveStatus === "saving" ? "Saving dashboard layout…" : saveStatus === "saved" ? "Dashboard layout saved" : "Dashboard layout has unsaved changes"}
            </p>
          )}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleWidgets.map((w) => w.id)}
          strategy={rectSortingStrategy}
        >
          {/* Enforce 2 columns and consistent row height for uniform widgets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20 auto-rows-[350px]">
            {visibleWidgets.map((widget) => {
              const Component = WIDGET_COMPONENTS[widget.id];
              if (!Component) return null;

              return (
                <SortableWidget
                  key={widget.id}
                  id={widget.id}
                  className="col-span-1"
                >
                  <div className="h-full w-full overflow-hidden">
                    {/* Pass onOpen to all widgets, only WeeklyRecapWidget uses it */}
                    <Suspense fallback={<WidgetFallback />}>
                      <Component onOpen={() => setRecapOpen(true)} />
                    </Suspense>
                  </div>
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <CustomizeDashboardModal
        open={customizing}
        onOpenChange={setCustomizing}
        widgets={widgets}
        onToggleWidget={toggleWidget}
      />

      {recapOpen && (
        <Suspense fallback={null}>
          <WeeklyRecapWizard open={recapOpen} onOpenChange={setRecapOpen} />
        </Suspense>
      )}
    </Layout>
  );
}
