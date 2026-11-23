import Decimal from "decimal.js";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useGrzPolicy, type GrzPolicyDefault, type GrzPolicyDefaults } from "@/hooks/useGrzSecurities";

const ROWS: Array<[keyof Omit<GrzPolicyDefaults, "status" | "label">, string]> = [
  ["couponWithholding", "Coupon withholding"],
  ["tbillDiscountWithholding", "T-bill discount withholding"],
  ["principalWithholding", "Principal withholding"],
  ["bondSaleWithholding", "Bond sale withholding"],
  ["tbillYieldDayBasis", "T-bill yield day basis"],
  ["auctionYieldDayBasis", "Auction calculator day basis"],
  ["accruedInterestDayCount", "Accrued interest day count"],
];

/** A fraction such as "0.15" reads as a percentage; a named convention reads as itself. */
function displayValue({ value }: GrzPolicyDefault): string {
  return /^\d+(\.\d+)?$/.test(value) ? `${new Decimal(value).times(100).toString()}%` : value;
}

/**
 * NEW-35: the GRZ conventions the app applies, each shown as a policy default
 * pending OI-03. Nothing here is a statement of current GRZ or ZRA rules.
 */
export function GrzPolicyNotice() {
  const { data: policy } = useGrzPolicy();
  if (!policy) return null;
  return (
    <Alert data-testid="grz-policy-notice">
      <Info className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{policy.label}</AlertTitle>
      <AlertDescription>
        <p className="mb-2">
          These GRZ figures use the conventions below. They are placeholders until the verified rules (OI-03) are
          confirmed, not a statement of current tax law.
        </p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {ROWS.map(([key, name]) => (
            <div key={key} className="flex justify-between gap-4">
              <dt title={policy[key].rule}>{name}</dt>
              <dd className="font-medium tabular-nums">{displayValue(policy[key])}</dd>
            </div>
          ))}
        </dl>
      </AlertDescription>
    </Alert>
  );
}
