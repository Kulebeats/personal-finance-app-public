import Layout from "@/components/Layout";
import { AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TimeRangeSelector } from "@/components/accounts";
import {
  useAccountsData,
  NetWorthChart,
  AccountFilters,
  AccountList,
  NetWorthSummary,
  ASSET_GROUPS,
  LIABILITY_GROUPS,
} from "@/features/accounts";

export default function Accounts() {
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
    isLoading,
    accountsLoading,
    accountsError,
  } = useAccountsData();

  if (accountsLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
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
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
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
          />
        </div>

        {/* Net Worth Chart Section */}
        <NetWorthChart
          data={chartData}
          currentNetWorth={summaryData.netWorthValue}
          isLoading={isLoading}
        >
          <TimeRangeSelector value={dateRange} onChange={(value) => setDateRange(value)} />
        </NetWorthChart>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Account Groups */}
          <div className="lg:col-span-2 space-y-6">
            <AccountList
              groupedAccounts={groupedAccounts}
              accounts={accounts}
              getGroupTotal={getGroupTotal}
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
    </Layout>
  );
}
