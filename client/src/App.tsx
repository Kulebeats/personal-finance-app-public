import { Switch, Route, Redirect, useLocation } from "wouter";
import { Suspense, useState, type ComponentType } from "react";
import { createDataQueryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/contexts/SessionContext";
import { SessionBoundary } from "@/components/session/SessionBoundary";
import { isPublicRoute } from "@/lib/public-routes";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { lazyWithChunkReload } from "@/lib/chunkReload";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";

// Lazy load pages for code splitting (reduces initial bundle by ~40%)
const Dashboard = lazyWithChunkReload(() => import("@/pages/Dashboard"));
const Reports = lazyWithChunkReload(() => import("@/pages/Reports"));
const Budget = lazyWithChunkReload(() => import("@/pages/Budget"));
const Investments = lazyWithChunkReload(() => import("@/pages/Investments"));
const Recurring = lazyWithChunkReload(() => import("@/pages/Recurring"));
const Goals = lazyWithChunkReload(() => import("@/pages/Goals"));
const Accounts = lazyWithChunkReload(() => import("@/pages/Accounts"));
const AccountDetail = lazyWithChunkReload(() => import("@/pages/AccountDetail"));
const Transactions = lazyWithChunkReload(() => import("@/pages/Transactions"));
const CashFlow = lazyWithChunkReload(() => import("@/pages/CashFlow"));
const Advice = lazyWithChunkReload(() => import("@/pages/Advice"));
const SettingsPage = lazyWithChunkReload(() => import("@/pages/settings"));
const Receipts = lazyWithChunkReload(() => import("@/pages/Receipts"));
const VerifyEmail = lazyWithChunkReload(() => import("@/pages/VerifyEmail"));
const ForgotPassword = lazyWithChunkReload(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazyWithChunkReload(() => import("@/pages/ResetPassword"));
const AcceptInvite = lazyWithChunkReload(() => import("@/pages/AcceptInvite"));

function routeWithBoundary(
  Component: ComponentType<any>,
  routeName: string
): ComponentType<any> {
  const BoundRoute = (props: Record<string, unknown>) => {
    const [location] = useLocation();

    return (
      <RouteErrorBoundary routeName={routeName} resetKey={location}>
        <Component {...props} />
      </RouteErrorBoundary>
    );
  };

  BoundRoute.displayName = `${routeName.replace(/\s+/g, "")}Route`;
  return BoundRoute;
}

const LoginRoute = routeWithBoundary(Login, "Login");
const DashboardRoute = routeWithBoundary(Dashboard, "Dashboard");
const ReportsRoute = routeWithBoundary(Reports, "Reports");
const CashFlowRoute = routeWithBoundary(CashFlow, "Cash Flow");
const AdviceRoute = routeWithBoundary(Advice, "Advice");
const BudgetRoute = routeWithBoundary(Budget, "Budget");
const InvestmentsRoute = routeWithBoundary(Investments, "Investments");
const RecurringRoute = routeWithBoundary(Recurring, "Recurring");
const GoalsRoute = routeWithBoundary(Goals, "Goals");
const AccountsRoute = routeWithBoundary(Accounts, "Accounts");
const AccountDetailRoute = routeWithBoundary(AccountDetail, "Account");
const TransactionsRoute = routeWithBoundary(Transactions, "Transactions");
const SettingsRoute = routeWithBoundary(SettingsPage, "Settings");
const ReceiptsRoute = routeWithBoundary(Receipts, "Receipts");
const VerifyEmailRoute = routeWithBoundary(VerifyEmail, "Email verification");
const ForgotPasswordRoute = routeWithBoundary(ForgotPassword, "Forgot password");
const ResetPasswordRoute = routeWithBoundary(ResetPassword, "Reset password");
const AcceptInviteRoute = routeWithBoundary(AcceptInvite, "Household invitation");
const NotFoundRoute = routeWithBoundary(NotFound, "Page");

// [NEW] Import Wizard
import { ImportWizardProvider } from "@/components/import/ImportWizardContext";
import { ImportWizard } from "@/components/import/ImportWizard";
import { CommandPalette } from "@/components/CommandPalette";
import { CommandPaletteProvider } from "@/contexts/CommandPaletteContext";

// Loading fallback for lazy loaded pages
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function LegacyVerifyEmailRedirect() {
  return (
    <Redirect
      to={`/verify-email${window.location.search}${window.location.hash}`}
      replace
    />
  );
}

export function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginRoute} />
      <Route path="/" component={DashboardRoute} />
      <Route path="/reports" component={ReportsRoute} />
      <Route path="/cash-flow" component={CashFlowRoute} />
      <Route path="/advice" component={AdviceRoute} />
      <Route path="/budget" component={BudgetRoute} />
      <Route path="/investments" component={InvestmentsRoute} />
      <Route path="/recurring" component={RecurringRoute} />
      <Route path="/goals" component={GoalsRoute} />
      <Route path="/goals/:id" component={GoalsRoute} />
      <Route path="/accounts" component={AccountsRoute} />
      <Route path="/accounts/:id" component={AccountDetailRoute} />
      <Route path="/transactions" component={TransactionsRoute} />
      <Route path="/profile" component={SettingsRoute} />
      <Route path="/settings" component={SettingsRoute} />
      <Route path="/settings/:section" component={SettingsRoute} />
      <Route path="/settings/:section/:subsection" component={SettingsRoute} />
      <Route path="/receipts" component={ReceiptsRoute} />
      <Route path="/verify-email" component={VerifyEmailRoute} />
      <Route path="/auth/verify-email" component={LegacyVerifyEmailRedirect} />
      <Route path="/forgot-password" component={ForgotPasswordRoute} />
      <Route path="/reset-password" component={ResetPasswordRoute} />
      <Route path="/invite/:code" component={AcceptInviteRoute} />
      <Route component={NotFoundRoute} />
    </Switch>
  );
}

function App() {
  const [location] = useLocation();
  const [publicClient] = useState(() => createDataQueryClient());
  const routes = <Suspense fallback={<PageLoader />}><Router /></Suspense>;
  return (
    <QueryClientProvider client={publicClient}>
      <GlobalErrorBoundary>
          <ThemeProvider
            defaultTheme="light"
            attribute="class"
            themes={["light", "dark", "light-gray"]}
          >
            <TooltipProvider>
              <SonnerToaster />
              <SessionProvider>
                {isPublicRoute(location) ? routes : (
                  <SessionBoundary>
                    <ImportWizardProvider>
                      <CommandPaletteProvider>
                        {routes}
                        <ImportWizard />
                        <CommandPalette />
                      </CommandPaletteProvider>
                    </ImportWizardProvider>
                  </SessionBoundary>
                )}
              </SessionProvider>
            </TooltipProvider>
          </ThemeProvider>
      </GlobalErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
