/**
 * EditAccountModal Component
 *
 * Modal for editing account properties including visibility toggles.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Loader2, Trash2, Archive } from "lucide-react";
import {
  useUpdateAccount,
  useUpdateAccountSettings,
  useDeleteAccount,
  useArchiveAccount,
} from "@/hooks";
import type { Account, UpdateAccountInput } from "@/lib/api";
import { parseMoneyString } from "@/lib/money";
import { PropertyFields } from "./form/PropertyFields";

interface EditAccountModalProps {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const accountTypes = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "mortgage", label: "Mortgage" },
  { value: "other_liability", label: "Other Liability" },
  { value: "real_estate", label: "Real Estate" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other" },
];

export function EditAccountModal({
  account,
  open,
  onOpenChange,
}: EditAccountModalProps) {
  const [name, setName] = useState(account.name);
  const [type, setType] = useState(account.type);
  const [institution, setInstitution] = useState(account.institution || "");
  const [estimatedValue, setEstimatedValue] = useState(
    account.estimatedValue || "",
  );
  const [purchaseDate, setPurchaseDate] = useState(account.purchaseDate || "");
  const [address, setAddress] = useState(account.address || "");
  const [isHidden, setIsHidden] = useState(account.isHidden);
  const [excludeFromNetWorth, setExcludeFromNetWorth] = useState(
    account.excludeFromNetWorth || false
  );
  const [hideTransactions, setHideTransactions] = useState(
    account.hideTransactions || false
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const updateAccount = useUpdateAccount();
  const updateSettings = useUpdateAccountSettings();
  const deleteAccount = useDeleteAccount();
  const archiveAccount = useArchiveAccount();

  // Reset form when account changes
  useEffect(() => {
    setName(account.name);
    setType(account.type);
    setInstitution(account.institution || "");
    setEstimatedValue(account.estimatedValue || "");
    setPurchaseDate(account.purchaseDate || "");
    setAddress(account.address || "");
    setIsHidden(account.isHidden);
    setExcludeFromNetWorth(account.excludeFromNetWorth || false);
    setHideTransactions(account.hideTransactions || false);
  }, [account]);

  const handleSave = async () => {
    const updateData: UpdateAccountInput = {
      updatedAt: account.updatedAt,
    };

    if (name !== account.name) {
      updateData.name = name;
    }
    if (type !== account.type) {
      updateData.type = type;
    }
    if (institution !== (account.institution || "")) {
      updateData.institution = institution || undefined;
    }

    const wasPropertyOrVehicle =
      account.type === "real_estate" || account.type === "vehicle";
    const isPropertyOrVehicle =
      type === "real_estate" || type === "vehicle";
    const nextEstimatedValue = estimatedValue.trim();
    const nextPurchaseDate = purchaseDate.trim();
    const nextAddress = address.trim();

    if (isPropertyOrVehicle) {
      if (nextEstimatedValue !== (account.estimatedValue || "")) {
        updateData.estimatedValue = nextEstimatedValue
          ? parseMoneyString(nextEstimatedValue).toFixed(2)
          : null;
      }
      if (nextPurchaseDate !== (account.purchaseDate || "")) {
        updateData.purchaseDate = nextPurchaseDate || null;
      }
      if (type === "real_estate") {
        if (nextAddress !== (account.address || "")) {
          updateData.address = nextAddress || null;
        }
      } else if (account.address) {
        updateData.address = null;
      }
    } else if (wasPropertyOrVehicle) {
      updateData.estimatedValue = null;
      updateData.purchaseDate = null;
      updateData.address = null;
    }

    const hasUpdates = Object.keys(updateData).length > 1;
    if (hasUpdates) {
      await updateAccount.mutateAsync({
        id: account.id,
        data: updateData,
      });
    }

    // Update visibility settings
    if (
      isHidden !== account.isHidden ||
      excludeFromNetWorth !== (account.excludeFromNetWorth || false) ||
      hideTransactions !== (account.hideTransactions || false)
    ) {
      await updateSettings.mutateAsync({
        id: account.id,
        settings: {
          isHidden,
          excludeFromNetWorth,
          hideTransactions,
        },
      });
    }

    onOpenChange(false);
  };

  const handleDelete = async () => {
    await deleteAccount.mutateAsync(account.id);
    onOpenChange(false);
  };

  const handleArchive = async () => {
    await archiveAccount.mutateAsync({
      id: account.id,
      archive: !account.isArchived,
    });
    onOpenChange(false);
  };

  const isSaving =
    updateAccount.isPending ||
    updateSettings.isPending ||
    deleteAccount.isPending ||
    archiveAccount.isPending;

  const hasError =
    updateAccount.isError ||
    updateSettings.isError ||
    deleteAccount.isError ||
    archiveAccount.isError;

  const errorMessage =
    updateAccount.error?.message ||
    updateSettings.error?.message ||
    deleteAccount.error?.message ||
    archiveAccount.error?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>

        {hasError && (
          <div
            role="alert"
            className="p-3 rounded-md bg-destructive/10 border border-destructive/20 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="text-sm text-destructive">
              <p className="font-medium">Operation failed</p>
              <p className="text-destructive/80">
                {errorMessage || "An unexpected error occurred. Please try again."}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Account Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Account name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Account Type</Label>
              <Select value={type} onValueChange={(value) => setType(value as Account["type"])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {accountTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution</Label>
              <Input
                id="institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Bank or institution name"
              />
            </div>

            {(type === "real_estate" || type === "vehicle") && (
              <PropertyFields
                estimatedValue={estimatedValue}
                onEstimatedValueChange={setEstimatedValue}
                purchaseDate={purchaseDate}
                onPurchaseDateChange={setPurchaseDate}
                address={address}
                onAddressChange={setAddress}
                showAddress={type === "real_estate"}
              />
            )}
          </div>

          <Separator />

          {/* Visibility Settings */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Visibility</h4>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="hide-account">Hide account</Label>
                <p className="text-xs text-muted-foreground">
                  Hide this account from the accounts list
                </p>
              </div>
              <Switch
                id="hide-account"
                checked={isHidden}
                onCheckedChange={setIsHidden}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="exclude-net-worth">
                  Exclude from net worth
                </Label>
                <p className="text-xs text-muted-foreground">
                  Don't include this account in net worth calculations
                </p>
              </div>
              <Switch
                id="exclude-net-worth"
                checked={excludeFromNetWorth}
                onCheckedChange={setExcludeFromNetWorth}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="hide-transactions">Hide transactions</Label>
                <p className="text-xs text-muted-foreground">
                  Hide from cash flow and budget calculations
                </p>
              </div>
              <Switch
                id="hide-transactions"
                checked={hideTransactions}
                onCheckedChange={setHideTransactions}
              />
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Actions</h4>

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleArchive}
              disabled={isSaving}
            >
              <Archive className="mr-2 h-4 w-4" />
              {account.isArchived ? "Restore account" : "Archive account"}
            </Button>

            {showDeleteConfirm ? (
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleDelete}
                  disabled={isSaving}
                >
                  {deleteAccount.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Confirm Delete"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full justify-start text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSaving}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete account
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
