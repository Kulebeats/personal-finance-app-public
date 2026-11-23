/**
 * The amount a member typed into the goal transfer dialog, checked as a decimal
 * string and sent exactly as typed. It never passes through a JS number, which
 * would round "2.675" to "2.67" (#245, Astra round 3).
 */

/** At most 13 whole digits (DECIMAL(15,2)) and at most 2 decimal places. */
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;

export interface TransferAmountCheck {
  /** The amount to send, unchanged, when it is valid. */
  amount?: string;
  /** Why the typed amount cannot be sent, shown under the field. */
  error?: string;
}

export function checkTransferAmount(typed: string): TransferAmountCheck {
  const value = typed.trim();
  if (!value) return {};
  if (!DECIMAL_AMOUNT.test(value)) {
    return { error: "Enter an amount like 100 or 100.50, with at most 2 decimal places." };
  }
  if (!/[1-9]/.test(value)) return { error: "Enter an amount above zero." };
  return { amount: value };
}
