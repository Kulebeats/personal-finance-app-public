import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccounts } from "@/hooks/useAccounts";
import { useSecurities } from "@/hooks/useInvestments";
import type { RecurringInvestment } from "@/hooks/investments/types";
import type { useRecurringPlanCommands } from "@/hooks/investments/useRecurringInvestments";
import { SipOccurrenceList } from "./SipOccurrenceList";

type Commands = ReturnType<typeof useRecurringPlanCommands>;

export const authorizationLabels = {
  authorization_recorded: "Authorization recorded",
  authorization_required: "Authorization required",
  inactive: "Inactive",
  pending_reconciliation: "Pending reconciliation",
} as const;

export function RecurringPlanFeedback({ commands }: { commands: Commands }) {
  const { message, busy, uncertain, allowed, retry } = commands;
  if (!message && !busy) return null;
  return (
    <div role={message ? "alert" : "status"} className="space-y-2 rounded-lg border p-3">
      <p>{message || "Submitting the recurring plan request…"}</p>
      {allowed && uncertain && (
        <Button variant="outline" onClick={() => void retry()}>Retry original request</Button>
      )}
    </div>
  );
}

export function RecurringInvestmentDetails({ plan, commands, readFailed, refresh }: {
  plan: RecurringInvestment;
  commands: Commands;
  readFailed: boolean;
  refresh: () => void;
}) {
  const { data: accounts } = useAccounts({ includeArchived: true, includeHidden: true });
  const { data: securities } = useSecurities();
  const accountName = accounts?.find(account => account.id === plan.accountId)?.name || plan.accountName;
  const instrument = securities?.find(security => security.id === plan.securityId);
  const instrumentName = instrument?.name || plan.securityName;
  const actions = plan.permittedActions ?? [];
  const canReviewAuthorization = commands.allowed && actions.includes("authorize");
  const canDeactivate = commands.allowed && actions.includes("deactivate");
  const blocked = Boolean(commands.pending) || readFailed;
  const showFeedback = !commands.pending ||
    (commands.pending.kind !== "create" && commands.pending.planId === plan.id);
  const sourcesAvailable = Boolean(accountName && instrumentName && plan.securityId);

  const planDetails = (
    <>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Authorization</dt><dd>{authorizationLabels[plan.authorizationStatus] ?? "Authorization unavailable"}</dd>
        <dt>Custody account</dt><dd>{accountName || "Account unavailable"}</dd>
        <dt>Instrument</dt><dd>{instrumentName || (plan.securityId ? "Instrument unavailable" : "No instrument selected")}</dd>
        <dt>Native amount</dt><dd>{plan.currency} {plan.amount}</dd>
        <dt>Frequency</dt><dd>{plan.frequency.replace(/_/g, " ")}</dd>
        {plan.authorizationInitialExecutionDate && (
          <><dt>Initial authorization date</dt><dd>{plan.authorizationInitialExecutionDate}</dd></>
        )}
        <dt>Next scheduled date</dt><dd>{plan.nextExecutionDate}</dd>
      </dl>
      {canReviewAuthorization && !plan.authorizationInitialExecutionDate && (
        <p className="text-sm">Confirm the next scheduled date as the initial authorization date.</p>
      )}
      {plan.authorizationStatus === "pending_reconciliation" && (
        <p className="text-sm">This declaration requires reconciliation before it can be executed.</p>
      )}
      {showFeedback ? <RecurringPlanFeedback commands={commands} /> : (
        <p className="text-sm">Finish the pending request before changing this plan.</p>
      )}
      {canReviewAuthorization && !sourcesAvailable && (
        <p className="text-sm">The custody account and instrument must be available to review authorization.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {canReviewAuthorization && (
          <Button disabled={blocked || !sourcesAvailable} onClick={() => void commands.authorize(plan)}>
            Confirm authorization
          </Button>
        )}
        {canDeactivate && (
          <Button variant="outline" disabled={blocked} onClick={() => void commands.deactivate(plan)}>
            Deactivate plan
          </Button>
        )}
      </div>
    </>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle tabIndex={-1} data-recurring-plan-title>Recurring plan details</DialogTitle>
        <DialogDescription>Review the plan and its recorded terms before making a change.</DialogDescription>
      </DialogHeader>
      {readFailed && (
        <div role="alert" className="space-y-2">
          <p>The current plan could not be refreshed.</p>
          <Button variant="outline" onClick={refresh}>Retry plan refresh</Button>
        </div>
      )}
      {plan.type === "sip" ? (
        <SipOccurrenceList planId={plan.id} accounts={accounts} securities={securities} planDetails={planDetails} />
      ) : planDetails}
    </>
  );
}
