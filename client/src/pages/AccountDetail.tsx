import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import {
  ImportTransactionsModal,
  ImportBalanceHistoryModal,
} from "@/components/accounts";
import { EditAccountModal } from "@/features/accounts";
import { useAccountDetail } from "@/features/accounts/hooks/useAccountDetail";
import { AccountDetailHeader } from "@/features/accounts/components/detail/AccountDetailHeader";
import { AccountBalanceChart } from "@/features/accounts/components/detail/AccountBalanceChart";
import { AccountTransactions } from "@/features/accounts/components/detail/AccountTransactions";
import { AccountSidebar } from "@/features/accounts/components/detail/AccountSidebar";
import { buildTransactionsUrl } from "@/features/transactions/transactionFilterParams";

import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/contexts/SessionContext";
import { ReconcileBalanceDialog, hasPendingReconciliation } from "@/features/accounts/components/detail/ReconcileBalanceDialog";

export default function AccountDetail() {
  const { status } = useSession();
  const client = useQueryClient();
  const [reconcileFor, setReconcileFor] = useState<string | null>(null);
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const accountId = params.id || "";

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [importTransactionsOpen, setImportTransactionsOpen] = useState(false);
  const [importBalanceHistoryOpen, setImportBalanceHistoryOpen] =
    useState(false);

  // Use centralized hook for all data
  const {
    account,
    accountLoading,
    accountError,
    balanceHistory,
    historyLoading,
    transactionsLoading,
    chartData,
    transactions,
    dateRange,
    setDateRange,
    refetchAccount,
    isRefetching,
  } = useAccountDetail(accountId);

  // Group transactions by date (simple UI grouping - not business logic)
  const groupedTransactions = useMemo(() => {
    const groups: Record<string, typeof transactions> = {};
    transactions.forEach((tx) => {
      const date = new Date(tx.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(tx);
    });
    return groups;
  }, [transactions]);

  if (accountLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (accountError || !account) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertCircle className="w-12 h-12 text-rose-500" />
          <p className="text-muted-foreground">Failed to load account</p>
          <Button onClick={() => navigate("/accounts")} variant="outline">
            Back to Accounts
          </Button>
        </div>
      </Layout>
    );
  }

  const mayWrite = status?.state === "ready" && status.household.id === account.householdId
    && ["owner", "admin", "member"].includes(status.household.role);
  const canReconcile = mayWrite && (!account.isArchived || hasPendingReconciliation(client, account.id));
  return (
    <Layout>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Back navigation */}
        <Link href="/accounts">
          <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
            Back to Accounts
          </button>
        </Link>

        {/* Account Header Section */}
        <AccountDetailHeader
          account={account}
          dateRange={dateRange}
          setDateRange={setDateRange}
          onEdit={() => setEditModalOpen(true)}
          onReconcile={canReconcile ? () => setReconcileFor(account.id) : undefined}
          onImportTransactions={() => setImportTransactionsOpen(true)}
          onImportBalanceHistory={() => setImportBalanceHistoryOpen(true)}
          hasHistory={!!balanceHistory && balanceHistory.length > 0}
        >
          {/* Chart injected into Header Card */}
          <AccountBalanceChart
            data={chartData}
            isLoading={historyLoading}
            currency={account.currency}
          />
        </AccountDetailHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Transactions List */}
          <AccountTransactions
            groupedTransactions={groupedTransactions}
            isLoading={transactionsLoading}
            currency={account.currency}
            onAddTransaction={() => {
              // `action=add` is a one-time navigation intent (open the Add
              // Transaction modal), not part of the filter contract (R8), so
              // it is appended after the filter query string built via
              // buildTransactionsUrl rather than baked into it.
              const filteredUrl = buildTransactionsUrl({ accountId });
              const separator = filteredUrl.includes("?") ? "&" : "?";
              navigate(`${filteredUrl}${separator}action=add`);
            }}
          />

          {/* Sidebar Widgets - MED-002: Pass refetch to avoid full page reload */}
          <AccountSidebar
            account={account}
            onRefresh={() => refetchAccount()}
            isRefreshing={isRefetching}
          />
        </div>
      </div>

      {mayWrite && reconcileFor === account.id && <ReconcileBalanceDialog
        key={account.id} account={account} close={() => setReconcileFor(null)} refresh={refetchAccount}
      />}

      {/* Modals */}
      <EditAccountModal
        account={account}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
      />

      <ImportTransactionsModal
        accountId={accountId}
        accountName={account.name}
        open={importTransactionsOpen}
        onOpenChange={setImportTransactionsOpen}
      />

      <ImportBalanceHistoryModal
        accountId={accountId}
        accountName={account.name}
        open={importBalanceHistoryOpen}
        onOpenChange={setImportBalanceHistoryOpen}
      />
    </Layout>
  );
}
