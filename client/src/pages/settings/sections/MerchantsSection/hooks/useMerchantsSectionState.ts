import { useMemo, useState } from "react";
import {
  useMerchants,
  useCreateMerchant,
  useUpdateMerchant,
  useDeleteMerchant,
  useMerchantDetails,
  useAddMerchantAlias,
  useDeleteMerchantAlias,
  useUploadMerchantLogo,
  useDeleteMerchantLogo,
  useMergeMerchants,
  useMerchantDuplicates,
  useMerchantMergeHistory,
  useUndoMerchantMerge,
  useSeedMerchants,
} from "@/hooks/use-settings";
import type { Merchant } from "@/hooks/use-settings";
import { useCategories } from "@/hooks/use-finance-data";

import { useMerchantFilters } from "./useMerchantFilters";
import { useMerchantBulkActions } from "./useMerchantBulkActions";
import { useMerchantMergePreview } from "./useMerchantMergePreview";
import { useMerchantFormDialog } from "./useMerchantFormDialog";
export type { MerchantFormState } from "./useMerchantFormDialog";
import { useMerchantHandlers } from "./useMerchantHandlers";

const MERCHANT_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Utilities",
  "Telecommunications",
  "Retail & Shopping",
  "Banking & Finance",
  "Healthcare",
  "Education",
  "Entertainment",
  "Other",
];

export type MerchantsSectionState = ReturnType<typeof useMerchantsSectionState>;

export function useMerchantsSectionState() {
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [detailMerchant, setDetailMerchant] = useState<Merchant | null>(null);
  const [duplicateTargets, setDuplicateTargets] = useState<
    Record<string, string>
  >({});
  const [isApplyingLogoPresets, setIsApplyingLogoPresets] = useState(false);

  // Data queries
  const { data: merchants, isLoading } = useMerchants();
  const { data: duplicateGroups } = useMerchantDuplicates();
  const createMerchant = useCreateMerchant();
  const updateMerchant = useUpdateMerchant();
  const deleteMerchant = useDeleteMerchant();
  const addMerchantAlias = useAddMerchantAlias();
  const deleteMerchantAlias = useDeleteMerchantAlias();
  const uploadMerchantLogo = useUploadMerchantLogo();
  const deleteMerchantLogo = useDeleteMerchantLogo();
  const mergeMerchants = useMergeMerchants();
  const mergeHistory = useMerchantMergeHistory();
  const undoMerge = useUndoMerchantMerge();
  const seedMerchants = useSeedMerchants();
  const { categories } = useCategories();

  // Use extracted hooks
  const filters = useMerchantFilters(merchants);
  const bulkActions = useMerchantBulkActions(
    merchants,
    filters.derived.filteredMerchants,
  );
  const mergePreview = useMerchantMergePreview(duplicateTargets);
  const formDialog = useMerchantFormDialog(merchants);
  const merchantDetails = useMerchantDetails(
    formDialog.state.editingMerchant?.id,
  );

  const duplicateSuggestions = useMemo(
    () => (duplicateGroups || []).slice(0, 3),
    [duplicateGroups],
  );

  const handlers = useMerchantHandlers({
    formDialog,
    mergePreview,
    bulkActions,
    mutations: {
      updateMerchant,
      createMerchant,
      mergeMerchants,
      deleteMerchant,
      addMerchantAlias,
      uploadMerchantLogo,
      deleteMerchantLogo,
    },
    merchants,
    mergeSource,
    setMergeSource,
    setIsApplyingLogoPresets,
  });

  const isSaving =
    createMerchant.isPending ||
    updateMerchant.isPending ||
    deleteMerchant.isPending;
  const deleteTransactionCount =
    merchantDetails.data?.merchant?.transactionCount ??
    formDialog.state.editingMerchant?.transactionCount ??
    0;
  const mergeCandidates =
    merchants?.filter(
      (merchant) => merchant.id !== formDialog.state.editingMerchant?.id,
    ) || [];

  return {
    data: {
      merchants,
      duplicateGroups,
      mergeHistory,
      merchantDetails,
      categories,
    },
    state: {
      editingMerchant: formDialog.state.editingMerchant,
      isDialogOpen: formDialog.state.isDialogOpen,
      merchantForm: formDialog.state.merchantForm,
      aliasInput: formDialog.state.aliasInput,
      logoFile: formDialog.state.logoFile,
      deleteAction: formDialog.state.deleteAction,
      mergeSource,
      mergeTarget: formDialog.state.mergeTarget,
      searchQuery: filters.state.searchQuery,
      sortBy: filters.state.sortBy,
      detailMerchant,
      duplicateTargets,
      mergingDuplicateKey: mergePreview.state.mergingDuplicateKey,
      mergePreviewGroup: mergePreview.state.mergePreviewGroup,
      mergePreviewTarget: mergePreview.state.mergePreviewTarget,
      mergePreviewSelection: mergePreview.state.mergePreviewSelection,
      mergePreviewNameSource: mergePreview.state.mergePreviewNameSource,
      mergePreviewLogoSource: mergePreview.state.mergePreviewLogoSource,
      bulkSelection: bulkActions.state.bulkSelection,
      bulkMergeTarget: bulkActions.state.bulkMergeTarget,
      deleteConfirmText: formDialog.state.deleteConfirmText,
      deleteAcknowledged: formDialog.state.deleteAcknowledged,
    },
    derived: {
      filteredMerchants: filters.derived.filteredMerchants,
      duplicateSuggestions,
      bulkSelectedIds: bulkActions.derived.bulkSelectedIds,
      bulkSelectedMerchants: bulkActions.derived.bulkSelectedMerchants,
      isSaving,
      deleteTransactionCount,
      mergeCandidates,
      logoPreset: formDialog.derived.logoPreset,
      merchantCategories: MERCHANT_CATEGORIES,
    },
    flags: { isLoading, isApplyingLogoPresets },
    mutations: {
      createMerchant,
      updateMerchant,
      deleteMerchant,
      addMerchantAlias,
      deleteMerchantAlias,
      uploadMerchantLogo,
      deleteMerchantLogo,
      mergeMerchants,
      undoMerge,
      seedMerchants,
    },
    actions: {
      setDialogOpen: formDialog.actions.setDialogOpen,
      setEditingMerchant: formDialog.actions.setEditingMerchant,
      setMerchantForm: formDialog.actions.setMerchantForm,
      setAliasInput: formDialog.actions.setAliasInput,
      setLogoFile: formDialog.actions.setLogoFile,
      setDeleteAction: formDialog.actions.setDeleteAction,
      setMergeSource,
      setMergeTarget: formDialog.actions.setMergeTarget,
      setSearchQuery: filters.actions.setSearchQuery,
      setSortBy: filters.actions.setSortBy,
      setDetailMerchant,
      setDuplicateTargets,
      setMergePreviewTarget: mergePreview.actions.setMergePreviewTarget,
      setMergePreviewSelection: mergePreview.actions.setMergePreviewSelection,
      setMergePreviewNameSource: mergePreview.actions.setMergePreviewNameSource,
      setMergePreviewLogoSource: mergePreview.actions.setMergePreviewLogoSource,
      setBulkSelection: bulkActions.actions.setBulkSelection,
      setBulkMergeTarget: bulkActions.actions.setBulkMergeTarget,
      setDeleteConfirmText: formDialog.actions.setDeleteConfirmText,
      setDeleteAcknowledged: formDialog.actions.setDeleteAcknowledged,
      openCreate: formDialog.actions.openCreate,
      openEdit: formDialog.actions.openEdit,
      handleSaveMerchant: handlers.handleSaveMerchant,
      handleDeleteMerchant: handlers.handleDeleteMerchant,
      handleAddAlias: handlers.handleAddAlias,
      handleUploadLogo: handlers.handleUploadLogo,
      handleRemoveLogo: handlers.handleRemoveLogo,
      applyLogoPresets: handlers.applyLogoPresets,
      toggleBulkSelection: bulkActions.actions.toggleBulkSelection,
      clearBulkSelection: bulkActions.actions.clearBulkSelection,
      selectAllVisible: bulkActions.actions.selectAllVisible,
      openMergePreview: mergePreview.actions.openMergePreview,
      handleMergePreviewConfirm: handlers.handleMergePreviewConfirm,
      handleMerge: handlers.handleMerge,
      resetMergePreview: mergePreview.actions.resetMergePreview,
      getDuplicateKey: mergePreview.actions.getDuplicateKey,
    },
  };
}
