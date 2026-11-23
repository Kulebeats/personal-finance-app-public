import { useEffect, useMemo, useState } from "react";
import type { Merchant } from "@/hooks/use-settings";
import { findMerchantLogoPreset } from "@/components/merchants/logoPresets";

/** The delete options the settings dialog offers (ORG-007): archive or merge. */
export type DeleteAction = "soft" | "merge";

export type MerchantFormState = {
  name: string;
  logoUrl: string;
  category: string;
  defaultCategoryId: string;
  notes: string;
  isActive: boolean;
};

const DEFAULT_FORM_STATE: MerchantFormState = {
  name: "",
  logoUrl: "",
  category: "",
  defaultCategoryId: "none",
  notes: "",
  isActive: true,
};

export interface MerchantFormDialogState {
  editingMerchant: Merchant | null;
  isDialogOpen: boolean;
  merchantForm: MerchantFormState;
  aliasInput: string;
  logoFile: File | null;
  deleteAction: DeleteAction;
  mergeTarget: string;
  deleteAcknowledged: boolean;
}

export interface MerchantFormDialogActions {
  setEditingMerchant: React.Dispatch<React.SetStateAction<Merchant | null>>;
  setDialogOpen: (open: boolean) => void;
  setMerchantForm: React.Dispatch<React.SetStateAction<MerchantFormState>>;
  setAliasInput: (input: string) => void;
  setLogoFile: (file: File | null) => void;
  setDeleteAction: (action: DeleteAction) => void;
  setMergeTarget: (target: string) => void;
  setDeleteAcknowledged: (acknowledged: boolean) => void;
  openCreate: () => void;
  openEdit: (merchant: Merchant) => void;
}

export interface MerchantFormDialogDerived {
  logoPreset: ReturnType<typeof findMerchantLogoPreset>;
}

export interface UseMerchantFormDialogResult {
  state: MerchantFormDialogState;
  actions: MerchantFormDialogActions;
  derived: MerchantFormDialogDerived;
}

export function useMerchantFormDialog(
  merchants: Merchant[] | undefined
): UseMerchantFormDialogResult {
  const [editingMerchant, setEditingMerchant] = useState<Merchant | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [merchantForm, setMerchantForm] =
    useState<MerchantFormState>(DEFAULT_FORM_STATE);
  const [aliasInput, setAliasInput] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [deleteAction, setDeleteAction] = useState<DeleteAction>("soft");
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  // Merge default target effect
  useEffect(() => {
    if (!editingMerchant) return;
    if (deleteAction !== "merge") return;
    if (mergeTarget) return;
    const fallbackTarget = merchants?.find(
      (merchant) => merchant.id !== editingMerchant.id
    );
    if (fallbackTarget) {
      setMergeTarget(fallbackTarget.id);
    }
  }, [deleteAction, editingMerchant, mergeTarget, merchants]);

  // Reset the acknowledgement when the action changes or the dialog closes
  useEffect(() => {
    setDeleteAcknowledged(false);
  }, [deleteAction, isDialogOpen]);

  const openCreate = () => {
    setEditingMerchant(null);
    setMerchantForm(DEFAULT_FORM_STATE);
    setAliasInput("");
    setLogoFile(null);
    setDeleteAction("soft");
    setDialogOpen(true);
  };

  const openEdit = (merchant: Merchant) => {
    setEditingMerchant(merchant);
    setMerchantForm({
      name: merchant.name,
      logoUrl: merchant.logoUrl || "",
      category: merchant.category || "",
      defaultCategoryId: merchant.defaultCategoryId || "none",
      notes: merchant.notes || "",
      isActive: merchant.isActive ?? true,
    });
    setAliasInput("");
    setLogoFile(null);
    setDeleteAction("soft");
    setDialogOpen(true);
  };

  const logoPreset = useMemo(
    () => findMerchantLogoPreset(merchantForm.name),
    [merchantForm.name]
  );

  return {
    state: {
      editingMerchant,
      isDialogOpen,
      merchantForm,
      aliasInput,
      logoFile,
      deleteAction,
      mergeTarget,
      deleteAcknowledged,
    },
    actions: {
      setEditingMerchant,
      setDialogOpen,
      setMerchantForm,
      setAliasInput,
      setLogoFile,
      setDeleteAction,
      setMergeTarget,
      setDeleteAcknowledged,
      openCreate,
      openEdit,
    },
    derived: {
      logoPreset,
    },
  };
}

export { type MerchantFormState as MerchantFormStateType };
