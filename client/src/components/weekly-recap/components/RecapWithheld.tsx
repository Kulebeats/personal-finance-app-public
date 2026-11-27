/**
 * C3-30: stands in for a step's figures while the recap's current access is
 * re-checked. The wizard's own status line announces the check; this text is
 * visual only so the announcement is not repeated.
 */
export default function RecapWithheld() {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      Figures are hidden until your current access is confirmed.
    </p>
  );
}
