/** Peer price writes and validity expiry do not deliver local invalidations.
 * Refresh visible valuation queries, plus each return to the view or tab.
 * This cadence never extends server-side price validity or authorizes a fill.
 */
export const valuationQueryPolicy = {
  staleTime: 60_000,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: "always",
  refetchOnMount: "always",
} as const;
