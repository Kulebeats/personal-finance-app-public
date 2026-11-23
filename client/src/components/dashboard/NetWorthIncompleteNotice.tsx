import type { ReportsNetWorthResponse } from "@shared/reports";

type OmittedValuation = NonNullable<ReportsNetWorthResponse["omittedValuations"]>[number];

const VALUATION_LABELS: Record<OmittedValuation, string> = {
  holdings: "investment holdings",
  tbills: "T-bills",
  pensions: "pensions",
  bonds: "bonds",
};

interface NetWorthIncompleteNoticeProps {
  incomplete?: boolean;
  omittedValuations?: OmittedValuation[];
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * FIN-14: the net-worth total left out classes it could not value. Says so
 * plainly instead of showing a smaller total as if it were complete.
 */
export function NetWorthIncompleteNotice({ incomplete, omittedValuations = [] }: NetWorthIncompleteNoticeProps) {
  if (incomplete !== true) return null;
  const labels = omittedValuations.map((kind) => VALUATION_LABELS[kind]);
  const subject = labels.length > 0 ? `Some ${joinLabels(labels)}` : "Some investments";
  return (
    <p role="status" className="mb-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      {subject} have no current value, so this total leaves them out.
    </p>
  );
}
