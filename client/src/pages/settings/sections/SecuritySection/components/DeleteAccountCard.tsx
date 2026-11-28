import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAccountErasure, useForgetErasurePassword } from "@/hooks/useAccountErasure";
import { userErrorMessage } from "@/lib/errorCopy";

export const ERASURE_CONFIRM_WORD = "DELETE";

const CONSEQUENCES = [
  "Your name, e-mail address, profile and sign-in details are erased, and every device is signed out.",
  "If you are the only member of your household, the household and all of its financial records are deleted: accounts, transactions, budgets, goals, investments, bonds and bills, receipts and uploaded files.",
  "If other members remain, the household's shared records stay with them and your membership ends. If you are the owner, ownership passes to the most senior remaining member.",
  "This cannot be undone. Export your data first if you want a copy.",
] as const;

function erasureErrorMessage(error: unknown): string {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "INVALID_CREDENTIALS") return "The password is incorrect.";
  return userErrorMessage(error, "Please try again.");
}

/**
 * AH-08 (d): DPA right to erasure. The person confirms with their password and
 * by typing DELETE; the server then asks for a fresh step-up (the step-up
 * dialog opens on its own) before it erases the account.
 */
export function DeleteAccountCard() {
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const erase = useAccountErasure();
  const forgetPassword = useForgetErasurePassword();
  const canSubmit = password.length > 0 && confirmWord === ERASURE_CONFIRM_WORD && !erase.isPending;

  useEffect(() => forgetPassword, [forgetPassword]);

  const handleOpenChange = (open: boolean) => {
    if (!open && erase.isPending) return;
    setIsOpen(open);
    if (!open) {
      setPassword("");
      setConfirmWord("");
      erase.reset();
      forgetPassword();
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) erase.mutate(password);
  };

  return (
    <SettingsCard
      title="Delete your account"
      description="Permanently erase your account and your personal data (right to erasure)."
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {CONSEQUENCES.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" className="mt-4 text-destructive">
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Delete my account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Delete your account permanently?</DialogTitle>
              <DialogDescription>
                Your account and personal data are erased and cannot be recovered. If you are the
                household's only member, all of its financial records are deleted too.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="erasure-password">Current password</Label>
                <Input
                  id="erasure-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={erase.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="erasure-confirm">Type {ERASURE_CONFIRM_WORD} to confirm</Label>
                <Input
                  id="erasure-confirm"
                  autoComplete="off"
                  value={confirmWord}
                  onChange={(event) => setConfirmWord(event.target.value)}
                  disabled={erase.isPending}
                />
              </div>
              {erase.isError && (
                <p role="alert" className="text-sm text-destructive">
                  Your account was not deleted. {erasureErrorMessage(erase.error)}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={erase.isPending}>
                Keep my account
              </Button>
              <Button type="submit" variant="destructive" disabled={!canSubmit}>
                {erase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {erase.isPending ? "Deleting…" : "Permanently delete account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
