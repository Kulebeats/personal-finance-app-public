import { Suspense } from "react";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { MerchantDetailView } from "@/components/merchants/MerchantDetailView";
import { useMerchantsSectionState } from "./hooks/useMerchantsSectionState";
import { MerchantsHeaderActions } from "./components/MerchantsHeaderActions";
import { MerchantsToolbar } from "./components/MerchantsToolbar";
import { MergeHistoryPanel } from "./components/MergeHistoryPanel";
import { DuplicateSuggestionsPanel } from "./components/DuplicateSuggestionsPanel";
import { BulkMergePanel } from "./components/BulkMergePanel";
import { MerchantsListPanel } from "./components/MerchantsListPanel";
import { InlineMergePanel } from "./components/InlineMergePanel";
import { MergePreviewDialog } from "./components/MergePreviewDialog";
import { MerchantFormDialog } from "./components/MerchantFormDialog";

export default function MerchantsSection() {
  const state = useMerchantsSectionState();

  return (
    <ErrorBoundary sectionName="Merchants">
      <Suspense fallback={<LoadingSection variant="list" />}>
        <SettingsCard
          title="Merchants"
          description="Manage your Zambian merchants, merge duplicates, and organize by category"
          isLoading={state.flags.isLoading}
          action={<MerchantsHeaderActions state={state} />}
        >
          <div className="flex flex-col h-[calc(100vh-260px)]">
            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 bg-card pb-4">
                <MerchantsToolbar state={state} />
              </div>

              <MergeHistoryPanel state={state} />
              <DuplicateSuggestionsPanel state={state} />
              <BulkMergePanel state={state} />
              <MerchantsListPanel state={state} />
            </div>
          </div>

          <InlineMergePanel state={state} />
          <MergePreviewDialog state={state} />
          <MerchantFormDialog state={state} />
        </SettingsCard>
      </Suspense>

      <MerchantDetailView
        merchantId={state.state.detailMerchant?.id || null}
        onClose={() => state.actions.setDetailMerchant(null)}
        onEdit={(merchant) => state.actions.openEdit(merchant)}
      />
    </ErrorBoundary>
  );
}
