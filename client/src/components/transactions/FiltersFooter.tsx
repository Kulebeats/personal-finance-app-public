import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

type FiltersFooterProps = {
  totalFiltersCount: number;
  onClear: () => void;
  onCancel: () => void;
  onApply: () => void;
};

export function FiltersFooter({
  totalFiltersCount,
  onClear,
  onCancel,
  onApply,
}: FiltersFooterProps) {
  return (
    <DialogFooter className="px-6 py-4 border-t">
      <div className="flex items-center justify-between w-full">
        <Button
          type="button"
          variant="ghost"
          onClick={onClear}
          disabled={totalFiltersCount === 0}
        >
          Clear
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onApply}
            className="bg-orange-500 hover:bg-orange-600"
          >
            Apply
          </Button>
        </div>
      </div>
    </DialogFooter>
  );
}
