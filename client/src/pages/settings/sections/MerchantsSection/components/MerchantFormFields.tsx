import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MerchantFormState,
  MerchantsSectionState,
} from "../hooks/useMerchantsSectionState";

type MerchantFormFieldsProps = {
  state: MerchantsSectionState;
  updateForm: (patch: Partial<MerchantFormState>) => void;
};

export function MerchantFormFields({ state, updateForm }: MerchantFormFieldsProps) {
  const { state: viewState, derived, data, actions, mutations } = state;

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="merchant-name">Name</Label>
        <Input
          id="merchant-name"
          value={viewState.merchantForm.name}
          onChange={(event) => updateForm({ name: event.target.value })}
          placeholder="e.g. Shoprite"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="merchant-logo">Logo URL (optional)</Label>
        <Input
          id="merchant-logo"
          value={viewState.merchantForm.logoUrl}
          onChange={(event) => updateForm({ logoUrl: event.target.value })}
          placeholder="https://logo.clearbit.com/shoprite.com"
        />
        {derived.logoPreset && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateForm({ logoUrl: derived.logoPreset?.url ?? "" })
              }
            >
              Use {derived.logoPreset.name} logo
            </Button>
            <span className="text-xs text-muted-foreground">
              Suggested preset
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Upload Logo</Label>
        <Input
          type="file"
          accept=".jpg,.jpeg,.png,.svg,.webp"
          onChange={(event) =>
            actions.setLogoFile(event.target.files?.[0] || null)
          }
        />
        <p className="text-xs text-muted-foreground">
          Allowed types: JPG, PNG, WEBP up to 2 MB, or a vector-only SVG up to
          512 KB (no embedded images or comments). SVG logos are converted to
          PNG.
        </p>
        {viewState.editingMerchant ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={actions.handleUploadLogo}
              disabled={!viewState.logoFile || mutations.uploadMerchantLogo.isPending}
            >
              Upload
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={actions.handleRemoveLogo}
              disabled={mutations.deleteMerchantLogo.isPending}
            >
              Remove Logo
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Logo uploads after you save the merchant.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          value={viewState.merchantForm.category}
          onValueChange={(value) => updateForm({ category: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {derived.merchantCategories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Default Transaction Category</Label>
        <Select
          value={viewState.merchantForm.defaultCategoryId}
          onValueChange={(value) => updateForm({ defaultCategoryId: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {data.categories?.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.icon} {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Input
          value={viewState.merchantForm.notes}
          onChange={(event) => updateForm({ notes: event.target.value })}
          placeholder="Optional notes"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={viewState.merchantForm.isActive}
          onChange={(event) => updateForm({ isActive: event.target.checked })}
        />
        <Label>Active</Label>
      </div>

      {viewState.editingMerchant && (
        <div className="space-y-2">
          <Label>Aliases</Label>
          <div className="flex gap-2">
            <Input
              value={viewState.aliasInput}
              placeholder="Add alias"
              onChange={(event) => actions.setAliasInput(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={actions.handleAddAlias}
              disabled={mutations.addMerchantAlias.isPending}
            >
              Add
            </Button>
          </div>
          <div className="space-y-2">
            {data.merchantDetails.data?.aliases.map((alias) => (
              <div
                key={alias.id}
                className="flex items-center justify-between rounded border px-2 py-1 text-sm"
              >
                <span>{alias.aliasName}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    mutations.deleteMerchantAlias.mutate({
                      merchantId: viewState.editingMerchant?.id || "",
                      aliasId: alias.id,
                    })
                  }
                  disabled={mutations.deleteMerchantAlias.isPending}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
