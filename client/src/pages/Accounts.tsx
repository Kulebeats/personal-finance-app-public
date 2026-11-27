import Layout from "@/components/Layout";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TimeRangeSelector } from "@/components/accounts";
import {
  useAccountsData,
  NetWorthChart,
  AccountFilters,
  AccountListRegion,
  AddAccountModal,
  NetWorthSummary,
  ASSET_GROUPS,
  LIABILITY_GROUPS,
} from "@/features/accounts";

export default function Accounts() {
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const fallbackFocus = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const openAddAccount: React.MouseEventHandler<HTMLButtonElement> = event => {
    opener.current = event.currentTarget;
    setAddAccountOpen(true);
  };
  // Keep the editor at the same page-level position while financial values are
  // withdrawn or renewed. Its draft is independent of the list's read lifetime.
  const editor = <AddAccountModal key="account-editor" open={addAccountOpen} onOpenChange={setAddAccountOpen}
    onCloseAutoFocus={event => {
      const target = opener.current?.isConnected ? opener.current : fallbackFocus.current;
      if (target?.isConnected) { event.preventDefault(); target.focus(); }
    }} />;
  const [summaryMode, setSummaryMode] = useState<"totals" | "percent">(
    "totals"
  );

  const {
    dateRange,
    setDateRange,
    ownerUserId,
    setOwnerUserId,
    refetch,
    exportSummary,
    getGroupTotal,
    accounts,
    groupedAccounts,
    summaryData,
    chartData,
    historyState, onRetryHistory,
    isLoading,
    accountsLoading,
    accountsError,
    ownerPreferencesError, retryOwnerPreferences, filterSaveError, filterSaving,
    retryOwnerFilter, resetOwnerFilter, temporaryOwnerFilter, currentUserId,
    isFiltered, hasAccessibleAccounts,
  } = useAccountsData();

  if (ownerPreferencesError) return <Layout><div className="space-y-4"><p role="alert">Saved account filter could not be loaded. {ownerPreferencesError.message}</p><Button ref={fallbackFocus} onClick={() => { void retryOwnerPreferences(); }}>Retry Loading Account Filter</Button></div>{editor}</Layout>;

  if (accountsLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
        {editor}
      </Layout>
    );
  }

  if (accountsError) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertCircle className="w-12 h-12 text-rose-500" />
          <p className="text-muted-foreground">Failed to load accounts</p>
          <Button
            type="button"
            variant="outline"
            ref={fallbackFocus}
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
        {editor}
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <AccountFilters
            ownerUserId={ownerUserId}
            onOwnerChange={setOwnerUserId}
            onRefresh={() => refetch()}
            currentUserId={currentUserId}
            onAddAccount={openAddAccount}
            addAccountButtonRef={fallbackFocus}
          />
        </div>
        <div className="space-y-2">
          <Button variant="outline" onClick={resetOwnerFilter} disabled={filterSaving && ownerUserId === "all"}>Reset Filter to All</Button>
          {filterSaving && <p role="status">Saving account filter…</p>}
          {filterSaveError && <div><p role="alert">{filterSaveError}</p><Button onClick={() => { void retryOwnerFilter(); }} disabled={filterSaving}>Retry Saving Filter</Button></div>}
          {temporaryOwnerFilter && <p>This owner filter is temporary. Your saved default has not changed.</p>}
        </div>

        {/* Net Worth Chart Section */}
        <NetWorthChart
          data={chartData}
          currentNetWorth={summaryData.netWorthValue}
          unavailable={summaryData.available === false}
          currency={summaryData.currency}
          isLoading={isLoading}
          historyState={historyState}
          onRetryHistory={onRetryHistory}
        >
          <TimeRangeSelector value={dateRange} onChange={(value) => setDateRange(value)} />
        </NetWorthChart>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Account Groups */}
          <div className="lg:col-span-2 space-y-6">
            <AccountListRegion
              historyState={historyState}
              groupedAccounts={groupedAccounts}
              accounts={accounts}
              getGroupTotal={getGroupTotal}
              isFiltered={isFiltered}
              hasAccessibleAccounts={hasAccessibleAccounts}
              onResetFilter={resetOwnerFilter}
              onAddAccount={openAddAccount}
            />
          </div>

          {/* Right Column: Summary Sidebar */}
          <div className="space-y-6">
            <NetWorthSummary
              data={summaryData}
              groupedAccounts={groupedAccounts}
              assetGroups={ASSET_GROUPS}
              liabilityGroups={LIABILITY_GROUPS}
              summaryMode={summaryMode}
              onSummaryModeChange={setSummaryMode}
              onExport={() => exportSummary.mutate()}
              isExporting={exportSummary.isPending}
              getGroupTotal={getGroupTotal}
            />
          </div>
        </div>
      </div>
      {editor}
    </Layout>
  );
}
