/**
 * R17 follow-up (#255 known limit): the in-flight Thandi requests of this
 * process, so a consent revocation or an erasure can abort the provider calls
 * they have already dispatched.
 *
 * This is per process. A revocation committed by another instance is caught
 * when the late answer arrives: the exchange fence and the unpersisted
 * settlement re-read consent under the household lock and discard it (see
 * `lockActorStanding`). The abort only stops the call sooner.
 *
 * @module ai/ai.inflight
 */

interface InFlightEntry {
  readonly actorId: string;
  readonly controller: AbortController;
}

export interface InFlightHandle {
  /** Aborted by the client's own signal, a revocation or an erasure. */
  readonly signal: AbortSignal;
  /** Stop tracking (call when the request has settled). */
  release(): void;
}

export type InFlightAbortReason = "consent_revoked" | "actor_erased";

const byHousehold = new Map<string, Set<InFlightEntry>>();

/** Track one admitted request; `parent` (the client disconnect) also aborts it. */
export function trackInFlight(householdId: string, actorId: string, parent?: AbortSignal): InFlightHandle {
  const controller = new AbortController();
  const entry: InFlightEntry = { actorId, controller };
  const entries = byHousehold.get(householdId) ?? new Set<InFlightEntry>();
  entries.add(entry);
  byHousehold.set(householdId, entries);
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  return {
    signal: controller.signal,
    release() {
      parent?.removeEventListener("abort", onParentAbort);
      entries.delete(entry);
      if (entries.size === 0 && byHousehold.get(householdId) === entries) byHousehold.delete(householdId);
    },
  };
}

/** Abort a household's in-flight requests (all, or only one actor's); returns how many. */
export function abortInFlight(householdId: string, reason: InFlightAbortReason, actorId?: string): number {
  const entries = [...(byHousehold.get(householdId) ?? [])].filter(
    (entry) => actorId === undefined || entry.actorId === actorId,
  );
  for (const entry of entries) entry.controller.abort(reason);
  return entries.length;
}

/** Abort an actor's in-flight requests in every household (erasure). */
export function abortActorInFlight(actorId: string): number {
  return [...byHousehold.keys()].reduce(
    (count, householdId) => count + abortInFlight(householdId, "actor_erased", actorId),
    0,
  );
}
