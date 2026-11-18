import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MerchantAvatar } from "@/components/merchants/MerchantAvatar";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

type MergePreviewDialogProps = {
  state: MerchantsSectionState;
};

export function MergePreviewDialog({ state }: MergePreviewDialogProps) {
  const { state: viewState, actions } = state;

  return (
    <Dialog
      open={!!viewState.mergePreviewGroup}
      onOpenChange={(open) => {
        if (!open) {
          actions.resetMergePreview();
        }
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Merge preview</DialogTitle>
          <DialogDescription>
            Compare merchants side-by-side and choose the primary name and logo
            before merging.
          </DialogDescription>
        </DialogHeader>
        {viewState.mergePreviewGroup && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="primary-merchant-select">Primary merchant</Label>
              <Select
                value={viewState.mergePreviewTarget}
                onValueChange={(value) => {
                  actions.setMergePreviewTarget(value);
                  actions.setMergePreviewSelection((prev) => ({
                    ...prev,
                    [value]: true,
                  }));
                  actions.setMergePreviewNameSource((prev) => prev || value);
                  actions.setMergePreviewLogoSource((prev) => prev || value);
                }}
              >
                <SelectTrigger id="primary-merchant-select" aria-label="Select primary merchant for merge">
                  <SelectValue placeholder="Select primary" />
                </SelectTrigger>
                <SelectContent>
                  {viewState.mergePreviewGroup.map((merchant) => (
                    <SelectItem key={merchant.id} value={merchant.id}>
                      {merchant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {viewState.mergePreviewGroup.map((merchant) => {
                const isTarget = merchant.id === viewState.mergePreviewTarget;
                return (
                  <div
                    key={merchant.id}
                    className={`rounded border p-3 ${
                      isTarget
                        ? "border-rose-300 bg-rose-50/30"
                        : "bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <MerchantAvatar
                        name={merchant.name}
                        logoUrl={merchant.logoUrl}
                        category={merchant.category}
                        size="md"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{merchant.name}</p>
                          {isTarget && (
                            <Badge variant="default" className="text-xs">
                              Primary
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {merchant.category || "Uncategorized"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {merchant.transactionCount || 0} transactions
                        </p>
                      </div>
                    </div>

                    <div
                      className="mt-3 grid grid-cols-2 gap-2 text-xs"
                      role="group"
                      aria-label={`Source options for ${merchant.name}`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="merge-preview-name"
                          checked={
                            viewState.mergePreviewNameSource === merchant.id
                          }
                          onChange={() =>
                            actions.setMergePreviewNameSource(merchant.id)
                          }
                          aria-label={`Use name from ${merchant.name}`}
                          className="focus:ring-2 focus:ring-primary"
                        />
                        Use name
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="merge-preview-logo"
                          checked={
                            viewState.mergePreviewLogoSource === merchant.id
                          }
                          onChange={() =>
                            actions.setMergePreviewLogoSource(merchant.id)
                          }
                          aria-label={`Use logo from ${merchant.name}`}
                          className="focus:ring-2 focus:ring-primary"
                        />
                        Use logo
                      </label>
                    </div>

                    <label className="mt-3 flex items-center justify-between text-xs cursor-pointer">
                      <span id={`include-label-${merchant.id}`}>Include in merge</span>
                      <input
                        type="checkbox"
                        checked={
                          viewState.mergePreviewSelection[merchant.id] || false
                        }
                        disabled={isTarget}
                        onChange={(event) =>
                          actions.setMergePreviewSelection((prev) => ({
                            ...prev,
                            [merchant.id]: event.target.checked,
                          }))
                        }
                        aria-labelledby={`include-label-${merchant.id}`}
                        aria-describedby={isTarget ? `target-note-${merchant.id}` : undefined}
                        className="focus:ring-2 focus:ring-primary"
                      />
                      {isTarget && (
                        <span id={`target-note-${merchant.id}`} className="sr-only">
                          Primary merchant is always included in merge
                        </span>
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={actions.resetMergePreview}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={actions.handleMergePreviewConfirm}
            disabled={
              !viewState.mergePreviewTarget ||
              viewState.mergingDuplicateKey !== null
            }
          >
            {viewState.mergingDuplicateKey ? "Merging..." : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
