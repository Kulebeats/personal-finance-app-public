/**
 * First-household guidance (NEW-27, R18.1 "first-run guidance").
 *
 * After "Create your household" the dashboard used to open on empty widgets
 * with nothing pointing at the next step. This card walks a new household
 * through account -> categories -> first transaction and disappears once the
 * household has at least one account and one transaction.
 *
 * It renders nothing while its counts first load, or if one fails before it
 * ever loaded: it is guidance, and each widget below already reports its own
 * load errors. A step whose refetch failed is never shown as done.
 */
import { Link } from "wouter";
import { CheckCircle2, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AddAccountModal } from "@/features/accounts";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useTransactions } from "@/hooks/useTransactions";

interface StepProps {
  isDone: boolean;
  title: string;
  detail: string;
  action: ReactNode;
  isActionKeptWhenDone?: boolean;
}

function Step({ isDone, title, detail, action, isActionKeptWhenDone = false }: StepProps) {
  const Icon = isDone ? CheckCircle2 : Circle;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Icon className={isDone ? "h-5 w-5 shrink-0 text-green-600" : "h-5 w-5 shrink-0 text-muted-foreground"} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium">
          {title}
          <span className="sr-only">{isDone ? " (done)" : " (to do)"}</span>
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {(!isDone || isActionKeptWhenDone) && action}
    </li>
  );
}

export function GettingStartedChecklist() {
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions({ limit: 1 });

  if (!accounts.data || !categories.data || !transactions.data) return null;

  // A failed refetch keeps the last data, which may be stale (an account
  // deleted in another tab). A step is done only when its latest read
  // succeeded; a failed one counts as unconfirmed, so it stays "to do".
  const hasAccount = !accounts.isError && accounts.data.length > 0;
  const hasCategories = !categories.isError && categories.data.categories.length > 0;
  const hasTransaction = !transactions.isError && transactions.data.transactions.length > 0;
  if (hasAccount && hasTransaction) return null;

  return (
    <Card role="region" className="mb-6 p-4 sm:p-6" aria-labelledby="getting-started-heading">
      <h2 id="getting-started-heading" className="text-lg font-semibold">Get started with your household</h2>
      <p className="text-sm text-muted-foreground">Three steps to your first budget and reports.</p>
      <ol className="mt-2 divide-y divide-border">
        <Step isDone={hasAccount} title="Add an account"
          detail="A bank, mobile money or cash account that your transactions belong to."
          action={<AddAccountModal><Button type="button" size="sm" className="min-h-11">Add account</Button></AddAccountModal>} />
        <Step isDone={hasCategories} isActionKeptWhenDone title="Review your categories"
          detail={hasCategories ? "Your household starts with a default set of categories you can rename or extend."
            : "Create the categories you want to track spending with."}
          action={<Button asChild size="sm" variant="outline" className="min-h-11"><Link href="/settings/organization/categories">Open categories</Link></Button>} />
        <Step isDone={hasTransaction} title="Add your first transaction"
          detail="Record income or spending against an account and a category."
          action={<Button asChild size="sm" variant="outline" className="min-h-11"><Link href="/transactions">Go to transactions</Link></Button>} />
      </ol>
    </Card>
  );
}
