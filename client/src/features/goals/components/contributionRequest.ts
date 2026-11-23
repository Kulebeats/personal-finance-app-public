import type { ApiError } from "@/lib/api";
import { isOverfundRefusal, type AccountContributionInput } from "../hooks/useContributeFromAccount";

/** What the server's replay digest binds: everything but the over-fund confirmation. */
export type ContributionRequest = Omit<AccountContributionInput, "confirmOverfund">;

export interface SentContribution {
  key: string;
  request: ContributionRequest;
}

/**
 * The request to send under `key`: the one first sent with that key, unchanged,
 * or a new one built now. A refetch between a lost response and the retry (a
 * budget category or account currency resolved again) cannot change what the
 * key sends, so the retry replays instead of conflicting (#245, round 5).
 */
export function contributionRequestFor(
  sent: SentContribution | null,
  key: string,
  build: () => ContributionRequest,
): SentContribution {
  return sent?.key === key ? sent : { key, request: build() };
}

/**
 * What to keep after a send fails. A definite refusal (any 4xx but the over-fund
 * 409) wrote nothing, so the next submit builds the request again, with the
 * category or currency as now resolved. A network failure or a 5xx may have
 * written it, and the over-fund 409 is answered by the same request confirmed,
 * so those keep it (#245 round 6, P2-3).
 */
export function afterContributionFailure(sent: SentContribution | null, error: unknown): SentContribution | null {
  const status = error instanceof Error ? (error as ApiError).status : undefined;
  const refused = status !== undefined && status >= 400 && status < 500;
  return refused && !isOverfundRefusal(error) ? null : sent;
}
