import type { Merchant } from "@/hooks/use-settings";
import type { UseMerchantFormDialogResult } from "./useMerchantFormDialog";
import type { UseMerchantMergePreviewResult } from "./useMerchantMergePreview";
import type { UseMerchantBulkActionsResult } from "./useMerchantBulkActions";
import { getPresetLogoUrl } from "@/components/merchants/logoPresets";
import {
  useCreateMerchant,
  useUpdateMerchant,
  useMergeMerchants,
  useDeleteMerchant,
  useAddMerchantAlias,
  useUploadMerchantLogo,
  useDeleteMerchantLogo,
} from "@/hooks/use-settings";

interface MerchantHandlersParams {
  formDialog: UseMerchantFormDialogResult;
  mergePreview: UseMerchantMergePreviewResult;
  bulkActions: UseMerchantBulkActionsResult;
  mutations: {
    updateMerchant: ReturnType<typeof useUpdateMerchant>;
    createMerchant: ReturnType<typeof useCreateMerchant>;
    mergeMerchants: ReturnType<typeof useMergeMerchants>;
    deleteMerchant: ReturnType<typeof useDeleteMerchant>;
    addMerchantAlias: ReturnType<typeof useAddMerchantAlias>;
    uploadMerchantLogo: ReturnType<typeof useUploadMerchantLogo>;
    deleteMerchantLogo: ReturnType<typeof useDeleteMerchantLogo>;
  };
  merchants: Merchant[] | undefined;
  mergeSource: string | null;
  setMergeSource: (source: string | null) => void;
  setIsApplyingLogoPresets: (applying: boolean) => void;
}

export function useMerchantHandlers({
  formDialog,
  mergePreview,
  bulkActions,
  mutations,
  merchants,
  mergeSource,
  setMergeSource,
  setIsApplyingLogoPresets,
}: MerchantHandlersParams) {
  const handleMergePreviewConfirm = async () => {
    const {
      mergePreviewGroup,
      mergePreviewTarget,
      mergePreviewSelection,
      mergePreviewNameSource,
      mergePreviewLogoSource,
    } = mergePreview.state;
    if (!mergePreviewGroup?.length || !mergePreviewTarget) return;

    const groupKey = mergePreview.actions.getDuplicateKey(mergePreviewGroup);
    const selectedIds = mergePreviewGroup
      .filter((merchant: Merchant) => mergePreviewSelection[merchant.id])
      .map((merchant: Merchant) => merchant.id);

    if (selectedIds.length < 2) return;

    mergePreview.setMergingDuplicateKey(groupKey);
    const sources = selectedIds.filter((id: string) => id !== mergePreviewTarget);
    try {
      const targetMerchant = mergePreviewGroup.find(
        (merchant: Merchant) => merchant.id === mergePreviewTarget
      );
      const nameSource = mergePreviewGroup.find(
        (merchant: Merchant) => merchant.id === mergePreviewNameSource
      );
      const logoSource = mergePreviewGroup.find(
        (merchant: Merchant) => merchant.id === mergePreviewLogoSource
      );
      const updatePayload: { name?: string; logoUrl?: string | null } = {};

      if (
        targetMerchant &&
        nameSource &&
        nameSource.name !== targetMerchant.name
      ) {
        updatePayload.name = nameSource.name;
      }

      const targetLogo = targetMerchant?.logoUrl ?? null;
      const chosenLogo = logoSource?.logoUrl ?? null;
      if (targetMerchant && chosenLogo !== targetLogo) {
        updatePayload.logoUrl = chosenLogo;
      }

      if (targetMerchant && Object.keys(updatePayload).length > 0) {
        await mutations.updateMerchant.mutateAsync({
          id: targetMerchant.id,
          data: updatePayload,
        });
      }

      for (const sourceId of sources) {
        await mutations.mergeMerchants.mutateAsync({
          sourceId,
          targetId: mergePreviewTarget,
        });
      }
    } finally {
      mergePreview.setMergingDuplicateKey(null);
      mergePreview.actions.resetMergePreview();
      bulkActions.actions.setBulkSelection({});
      bulkActions.actions.setBulkMergeTarget("");
    }
  };

  const handleMerge = () => {
    if (!mergeSource || !formDialog.state.mergeTarget) return;
    mutations.mergeMerchants.mutate(
      { sourceId: mergeSource, targetId: formDialog.state.mergeTarget },
      {
        onSuccess: () => {
          setMergeSource(null);
          formDialog.actions.setMergeTarget("");
        },
      }
    );
  };

  const handleSaveMerchant = async () => {
    const { merchantForm, editingMerchant, logoFile } = formDialog.state;
    if (!merchantForm.name.trim()) return;
    const payload = {
      name: merchantForm.name.trim(),
      logoUrl: merchantForm.logoUrl.trim() || null,
      category: merchantForm.category.trim() || null,
      defaultCategoryId:
        merchantForm.defaultCategoryId === "none"
          ? null
          : merchantForm.defaultCategoryId || null,
      notes: merchantForm.notes.trim() || null,
      isActive: merchantForm.isActive,
    };

    try {
      const savedMerchant = editingMerchant
        ? await mutations.updateMerchant.mutateAsync({
            id: editingMerchant.id,
            data: payload,
          })
        : await mutations.createMerchant.mutateAsync(payload);

      if (logoFile) {
        await mutations.uploadMerchantLogo.mutateAsync({
          id: savedMerchant.id,
          file: logoFile,
        });
        formDialog.actions.setLogoFile(null);
      }
      formDialog.actions.setDialogOpen(false);
    } catch (error) {
      console.error("Failed to save merchant:", error);
    }
  };

  const handleDeleteMerchant = () => {
    const { editingMerchant, deleteAction, mergeTarget, deleteAcknowledged } =
      formDialog.state;
    if (!editingMerchant || !deleteAcknowledged) return;
    const closeDialog = {
      onSuccess: () => {
        formDialog.actions.setDialogOpen(false);
        formDialog.actions.setEditingMerchant(null);
      },
    };
    if (deleteAction === "merge") {
      // The merge endpoint moves the transactions and records the undo.
      if (!mergeTarget) return;
      mutations.mergeMerchants.mutate(
        { sourceId: editingMerchant.id, targetId: mergeTarget },
        closeDialog
      );
      return;
    }
    mutations.deleteMerchant.mutate(
      { id: editingMerchant.id, options: { action: "soft" } },
      closeDialog
    );
  };

  const handleAddAlias = () => {
    const { editingMerchant, aliasInput } = formDialog.state;
    if (!editingMerchant || !aliasInput.trim()) return;
    mutations.addMerchantAlias.mutate({
      merchantId: editingMerchant.id,
      aliasName: aliasInput.trim(),
    });
    formDialog.actions.setAliasInput("");
  };

  const handleUploadLogo = () => {
    const { editingMerchant, logoFile } = formDialog.state;
    if (!editingMerchant || !logoFile) return;
    mutations.uploadMerchantLogo.mutate({ id: editingMerchant.id, file: logoFile });
    formDialog.actions.setLogoFile(null);
  };

  const handleRemoveLogo = () => {
    if (!formDialog.state.editingMerchant) return;
    mutations.deleteMerchantLogo.mutate(formDialog.state.editingMerchant.id);
  };

  const applyLogoPresets = async () => {
    if (!merchants || mutations.updateMerchant.isPending) return;
    setIsApplyingLogoPresets(true);
    try {
      for (const merchant of merchants) {
        if (merchant.logoUrl) continue;
        const presetUrl = getPresetLogoUrl(merchant.name);
        if (!presetUrl) continue;
        await mutations.updateMerchant.mutateAsync({
          id: merchant.id,
          data: { logoUrl: presetUrl },
        });
      }
    } finally {
      setIsApplyingLogoPresets(false);
    }
  };

  return {
    handleMergePreviewConfirm,
    handleMerge,
    handleSaveMerchant,
    handleDeleteMerchant,
    handleAddAlias,
    handleUploadLogo,
    handleRemoveLogo,
    applyLogoPresets,
  };
}
