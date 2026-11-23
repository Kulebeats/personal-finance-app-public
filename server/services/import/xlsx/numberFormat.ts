/**
 * IMP-01 review r5 P1, on SheetJS (owner decision N2), split in review r6 P1:
 * what a number cell's format does to its import. A bank reference shown and
 * exported as 000123 must be the Reference 000123, never 123, or the same
 * transaction gets two identities. The stored decimal is still what every
 * other field reads, so a display can never turn 123.000 into a valid Amount.
 *
 * SheetJS renders the cell's format (`w`). That text is accepted as a
 * Reference display only when it is the stored value with leading zeros
 * added: same digits, same sign. Anything else is reported, never guessed.
 * This includes a negative section without a minus, where Excel shows -5 as
 * 0005.
 */

const SHOWN_AS_STORED = /^(General|@)$/i;
const ZERO_PADDED = /^(-?)(\d+)$/;
const INTEGRAL_DECIMAL = /^(-?)(\d+)(?:\.0*)?$/;

const ONLY_ZEROS = /^0*$/;
const isNegative = (sign: string, digits: string) => sign === "-" && /[1-9]/.test(digits);

/**
 * The display is the stored integral value with leading zeros added (and
 * differs from it). It keeps every stored integer digit, zeros included, so
 * a display can never drop zeros the stored value has (final pass P1: a stale
 * 0123 is not the Reference of a stored 000123).
 */
export function isZeroPaddedDisplay(stored: string, display: string): boolean {
  const shown = ZERO_PADDED.exec(display);
  const value = INTEGRAL_DECIMAL.exec(stored);
  if (!shown || !value || display === stored) return false;
  const [digits, storedDigits] = [shown[2], value[2]];
  const keepsStoredDigits = digits.endsWith(storedDigits) && ONLY_ZEROS.test(digits.slice(0, digits.length - storedDigits.length));
  return keepsStoredDigits && isNegative(shown[1], digits) === isNegative(value[1], storedDigits);
}

/** How a number cell imports under its format. */
export type NumberDisplay =
  /** Excel shows the stored value. */
  | { kind: "stored" }
  /** Excel adds leading zeros: the Reference reads `text`, every other field the stored value. */
  | { kind: "padded"; text: string }
  /** Excel shows something else: a cell issue, scoped to the Reference field. */
  | { kind: "other" };

export function numberDisplay(plain: string, format: string | undefined, rendered: string | undefined): NumberDisplay {
  if (format === undefined || SHOWN_AS_STORED.test(format.trim()) || rendered === plain) return { kind: "stored" };
  return rendered !== undefined && isZeroPaddedDisplay(plain, rendered) ? { kind: "padded", text: rendered } : { kind: "other" };
}
