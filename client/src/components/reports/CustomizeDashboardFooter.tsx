import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CustomizeDashboardFooterProps {
  saving: boolean;
  resetting: boolean;
  failedReset: boolean;
  error: string | null;
  onSave: () => Promise<void>;
  onReset: () => Promise<void>;
  onCancel: () => void;
}

export function CustomizeDashboardFooter({
  saving,
  resetting,
  failedReset,
  error,
  onSave,
  onReset,
  onCancel,
}: CustomizeDashboardFooterProps) {
  return (
    <>
      <DialogFooter className="mt-4">
        <div className="flex justify-between w-full">
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => { void onReset(); }}
            disabled={saving}
          >
            {resetting ? "Resetting…" : failedReset ? "Retry Reset" : "Reset Defaults"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={() => { void onSave(); }} disabled={saving}>
              {saving && !resetting ? "Saving…" : error && !failedReset ? "Retry Save" : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogFooter>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
