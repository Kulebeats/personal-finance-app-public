import { describe, expect, it } from "vitest";
import { afterContributionFailure, contributionRequestFor, type ContributionRequest } from "../components/contributionRequest";

const request = (categoryId?: string): ContributionRequest => ({
  accountId: "account-1",
  amount: { amount: "10.00", currency: "ZMW" },
  date: "2026-11-18",
  categoryId,
  idempotencyKey: "key-1",
});

/** #245 round 5: a retry under the same key resends the first request, whatever was refetched since. */
describe("contributionRequestFor", () => {
  it("resends the first request while the key is unchanged, even if the category resolved differently", () => {
    const first = contributionRequestFor(null, "key-1", () => request("savings-1"));
    const retry = contributionRequestFor(first, "key-1", () => request("savings-2"));
    expect(retry.request.categoryId).toBe("savings-1");
  });

  it("drops the request on a definite refusal, keeps it when the outcome is unknown or a confirmation answers it", () => {
    const sent = contributionRequestFor(null, "key-1", () => request("savings-1"));
    const failure = (status: number | undefined, message: string) => Object.assign(new Error(message), { status });
    expect([
      afterContributionFailure(sent, failure(422, "Category is archived")),
      afterContributionFailure(sent, failure(409, "Confirm overfunding to continue")),
      afterContributionFailure(sent, new TypeError("Failed to fetch")),
      afterContributionFailure(sent, failure(503, "Service unavailable")),
    ]).toEqual([null, sent, sent, sent]);
  });

  it("builds a new request once the key changes", () => {
    const first = contributionRequestFor(null, "key-1", () => request("savings-1"));
    const next = contributionRequestFor(first, "key-2", () => ({ ...request("savings-2"), idempotencyKey: "key-2" }));
    expect(next).toEqual({ key: "key-2", request: { ...request("savings-2"), idempotencyKey: "key-2" } });
  });
});
