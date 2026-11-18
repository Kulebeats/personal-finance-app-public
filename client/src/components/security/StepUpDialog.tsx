import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepUpDialogProps {
  open: boolean;
  level: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

const LEVEL_COPY: Record<string, string> = {
  DESTRUCTIVE:
    "This is a destructive action. Confirm your password to continue.",
  FINANCIAL: "This moves money. Confirm your password to continue.",
  SETTINGS:
    "This changes sensitive settings. Confirm your password to continue.",
};

export function StepUpDialog({
  open,
  level,
  submitting,
  error,
  onSubmit,
  onCancel,
}: StepUpDialogProps) {
  const [password, setPassword] = useState("");

  // Never retain the password between opens.
  useEffect(() => {
    if (!open) setPassword("");
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    onSubmit(password);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Confirm it's you</DialogTitle>
            <DialogDescription>
              {LEVEL_COPY[level] ?? LEVEL_COPY.SETTINGS}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor="step-up-password">Password</Label>
            <Input
              id="step-up-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "step-up-error" : undefined}
              disabled={submitting}
            />
            {error && (
              <p
                id="step-up-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!password || submitting}>
              {submitting ? "Verifying…" : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
