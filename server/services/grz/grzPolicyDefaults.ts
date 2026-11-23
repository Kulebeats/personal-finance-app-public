import { WHT_RATE_FRACTION } from "../grz-service";

/**
 * NEW-35: the conventions the GRZ code applies today, published as labelled
 * policy defaults. OI-03 (verified current GRZ tax, withholding, day-count and
 * fee conventions) is still with the owner, so none of these is a claim about
 * current law or market practice. They describe the code, not the rules.
 * Changing a value here changes only the label: the calculations live in
 * grz-service.ts and bondSale.ts.
 */
export const GRZ_POLICY_STATUS = "policy_default_pending_OI-03" as const;
export const GRZ_POLICY_LABEL = "Policy default, pending OI-03";

export interface GrzPolicyDefault {
  /** A plain-English statement of the rule the code applies. */
  rule: string;
  /** The parameter it uses, as a decimal string or a named convention. */
  value: string;
}

export interface GrzPolicyDefaults {
  status: typeof GRZ_POLICY_STATUS;
  label: string;
  couponWithholding: GrzPolicyDefault;
  tbillDiscountWithholding: GrzPolicyDefault;
  principalWithholding: GrzPolicyDefault;
  bondSaleWithholding: GrzPolicyDefault;
  tbillYieldDayBasis: GrzPolicyDefault;
  auctionYieldDayBasis: GrzPolicyDefault;
  accruedInterestDayCount: GrzPolicyDefault;
}

const whtRate = String(WHT_RATE_FRACTION);

export const GRZ_POLICY_DEFAULTS: Readonly<GrzPolicyDefaults> = Object.freeze({
  status: GRZ_POLICY_STATUS,
  label: GRZ_POLICY_LABEL,
  couponWithholding: { rule: "Withholding on each scheduled bond coupon, as a fraction of the gross coupon", value: whtRate },
  tbillDiscountWithholding: { rule: "Withholding on a T-bill's discount (face value less purchase price)", value: whtRate },
  principalWithholding: { rule: "Withholding on returned bond principal", value: "0" },
  bondSaleWithholding: { rule: "Withholding on a bond sale's proceeds", value: "0" },
  tbillYieldDayBasis: { rule: "Recorded T-bill yield: discount / purchase price x 365 / tenor days", value: "ACT/365" },
  auctionYieldDayBasis: { rule: "T-bill auction calculator: price and yields from the discount rate x tenor days / 360", value: "ACT/360" },
  accruedInterestDayCount: { rule: "Accrued interest calculator default; ACT/360 and 30/360 can be chosen", value: "ACT/365" },
});
