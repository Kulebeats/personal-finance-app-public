import Layout from "@/components/Layout";
import { lazy, Suspense, useState, type ElementType } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Home, ArrowRight, SlidersHorizontal } from "lucide-react";
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
import { useProfile, useHousehold } from "@/hooks/use-settings";
import { useDashboardWidgets } from "@/hooks/useDashboardWidgets";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api";

// FIX P7b-3: the "brand-new user, needs onboarding" gate below used to key on
// a substring match of the server's error message ("No household found"),
// so any wording change server-side would silently drop new users into a
// broken dashboard instead of onboarding. This checks the structural signal
// instead: the distinguishable HOUSEHOLD_NOT_FOUND error code (see
// server/core/errors/HouseholdNotFoundError.ts), falling back to the raw
// HTTP 404 status for a server that hasn't deployed that code yet - the
// /api/household/general endpoint 404s ONLY for the no-household case, so
// status alone is still a safe structural signal, not prose.
function isHouseholdNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const apiError = error as ApiError;
  return apiError.code === "HOUSEHOLD_NOT_FOUND" || apiError.status === 404;
}

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
  const [, setLocation] = useLocation();

  // Check for household setup
  const { error: householdError, isLoading: householdLoading } = useHousehold();

  const {
    widgets,
    toggleWidget,
    reorderWidgets,
    isLoading: widgetsLoading,
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

  // If no household, show onboarding state. Keep this below all hooks so the
  // hook count cannot change when household state transitions.
  if (
    !householdLoading &&
    householdError &&
    isHouseholdNotFoundError(householdError)
  ) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="w-full max-w-lg text-center shadow-lg border-2 border-dashed">
            <CardHeader>
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Home className="w-8 h-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Welcome to Capital!</CardTitle>
              <CardDescription className="text-lg">
                Let's get you set up. You need to create a household to start
                tracking your finances.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setLocation("/settings/household")}
                size="lg"
                className="w-full sm:w-auto gap-2"
              >
                Create My Household <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Good morning,{" "}
            {userProfile?.firstName || userProfile?.displayName || userProfile?.fullName?.trim().split(/\s+/)[0] || "User"}
          </p>
        </div>
        <div className="flex gap-3">
          <AddAccountModal>
            <Button type="button">
              <Plus className="w-4 h-4" /> Add Account
            </Button>
          </AddAccountModal>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCustomizing(true)}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Customize
          </Button>
        </div>
      </div>

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
