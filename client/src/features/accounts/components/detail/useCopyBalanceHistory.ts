import { useLayoutEffect, useRef, useState } from "react";
import { accountsApi } from "@/lib/api";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import { useToast } from "@/hooks/use-toast";

interface CopyScope { accountId: string; active: boolean; request: symbol | null }

/** Copy the authorized export; never release a late account/session result. */
export function useCopyBalanceHistory(accountId: string) {
  const { toast } = useToast();
  const [isPending, setPending] = useState(false);
  const scopeRef = useRef<CopyScope | null>(null);
  useLayoutEffect(() => {
    const scope: CopyScope = { accountId, active: true, request: null };
    scopeRef.current = scope;
    setPending(false);
    return () => { scope.active = false; };
  }, [accountId]);

  async function copy() {
    const scope = scopeRef.current;
    if (!scope?.active || scope.accountId !== accountId || scope.request) return;
    const operation = captureOperationLifetime();
    if (!operation) {
      toast({ title: "Copy failed", description: "Your session changed. Please start this action again.", variant: "destructive" });
      return;
    }
    const request = Symbol("balance-history-copy");
    scope.request = request;
    setPending(true);
    const isCurrent = () => {
      if (!scope.active || scopeRef.current !== scope || scope.request !== request) return false;
      try { assertOperationLifetime(operation); return true; } catch { return false; }
    };
    try {
      if (!isCurrent()) return;
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
      const blob = await accountsApi.exportBalanceHistory(accountId, operation);
      if (!isCurrent()) return;
      const text = await blob.text();
      if (!isCurrent()) return;
      // A dispatched clipboard write cannot be cancelled; fence before dispatch
      // and suppress notifications if its owner retires before completion.
      await clipboard.writeText(text);
      if (isCurrent()) toast({ title: "Balance history copied", description: "CSV copied to your clipboard." });
    } catch {
      if (isCurrent()) toast({
        title: "Copy failed",
        description: "Could not copy balance history. Try again, or use Download balance history.",
        variant: "destructive",
      });
    } finally {
      if (scope.active && scopeRef.current === scope && scope.request === request) {
        scope.request = null;
        setPending(false);
      }
    }
  }
  return { copy, isPending };
}
