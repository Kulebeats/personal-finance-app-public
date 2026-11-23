/**
 * A-02 test helper: a "CSV wins" execute removes only the rows the member reviewed in the preview.
 * Suites that exercise an overwrite as a member who accepts the preview send this reviewed set.
 */
import type { Test } from "supertest";

export interface ReviewedRemovalBody { id: string; version: string }

/** Runs the given preview request and returns its removals as the execute body's `reviewedRemovals`. */
export async function reviewedRemovalsFrom(preview: Test): Promise<ReviewedRemovalBody[]> {
  const res = await preview;
  if (res.status !== 200) throw new Error(`Import preview failed with ${res.status}: ${JSON.stringify(res.body)}`);
  const removals: ReviewedRemovalBody[] = res.body.removals ?? [];
  return removals.map(({ id, version }) => ({ id, version }));
}
