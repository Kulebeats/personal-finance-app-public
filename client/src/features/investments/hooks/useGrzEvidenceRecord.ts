import { useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSession } from "@/contexts/SessionContext";
import { apiCall, generateIdempotencyKey, type ApiError } from "@/lib/api";
import { assertOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import type { GrzBond } from "@/hooks/useGrzSecurities";
import { holdingEvidenceKey, makeEvidencePayload, verifyEvidenceResponse, type EvidenceFields, type EvidenceKind, type EvidencePayload } from "../grzEvidenceContract";

interface FrozenRequest { kind: EvidenceKind; bondId: string; payload: EvidencePayload; body: string; operation: OperationLifetime; scope: string }
type State = { status: "idle" | "submitting" | "uncertain" | "declined" | "recorded"; message?: string; request?: FrozenRequest; retryDenied?: boolean };
const uncertain = "The result is unconfirmed. Retry the same evidence before recording another request.";

function createEvidenceState() {
  let state: State = { status: "idle" };
  const listeners = new Set<() => void>();
  return {
    read: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(next: State) {
      state = next;
      listeners.forEach(listener => listener());
    },
  };
}
const lifetimes = new WeakMap<OperationLifetime, Map<string, ReturnType<typeof createEvidenceState>>>();
const inactive = createEvidenceState();
function holdingState(operation: OperationLifetime | null, scope: string) {
  if (!operation?.active) return inactive;
  let holdings = lifetimes.get(operation);
  if (!holdings) { holdings = new Map(); lifetimes.set(operation, holdings); }
  let store = holdings.get(scope);
  if (!store) { store = createEvidenceState(); holdings.set(scope, store); }
  return store;
}

/** Keep submitted operations across navigation within the originating data lifetime. */
export function useGrzEvidenceRecord(bond: GrzBond) {
  const { status, lifetime } = useSession();
  const operation = lifetime?.operation ?? null;
  const allowed = status?.state === "ready" && ["owner", "admin", "member"].includes(status.household.role) && operation?.active === true &&
    operation.expectations?.subject === status.subject.id && operation.expectations.household === status.household.id;
  const scope = JSON.stringify([lifetime?.key, holdingEvidenceKey(bond)]);
  const store = holdingState(operation, scope);
  const state = useSyncExternalStore(store.subscribe, store.read, store.read);
  const publish = store.publish;
  const mutation = useMutation({ mutationFn: async (request: FrozenRequest) => {
    assertOperationLifetime(request.operation);
    const endpoint = request.kind === "acquisition" ? "principal-basis" : "valuations";
    const result = await apiCall<unknown>(`/grz/bonds/${request.bondId}/${endpoint}`, { method: "POST", body: request.body }, false, false, request.operation);
    assertOperationLifetime(request.operation);
    return verifyEvidenceResponse(result, request.bondId, request.kind, request.payload);
  }, retry: false });
  const fresh = (request: FrozenRequest) => {
    if (!allowed || operation !== request.operation || scope !== request.scope || store.read().request !== request) return false;
    try { assertOperationLifetime(request.operation); return true; } catch { return false; }
  };
  const dispatch = async (request: FrozenRequest, retry: boolean) => {
    if (!fresh(request)) return;
    publish({ status: "submitting", request });
    try {
      await mutation.mutateAsync(request);
      if (!fresh(request)) return;
      publish({ status: "recorded", message: request.kind === "acquisition" ? "Acquisition evidence recorded." :
        request.payload.sourceDate === new Date().toISOString().slice(0, 10) ? "Market evidence recorded." : "Historical market evidence recorded. It does not establish today's value." });
      // An accepted append stays accepted even when a later refresh fails.
      const client = lifetime?.client;
      if (client) for (const key of ["accounts", "grz", "investments", "dashboard"]) void client.invalidateQueries({ queryKey: [key] });
    } catch (error) {
      if (!fresh(request)) return;
      const code = (error as ApiError).status, declined = code !== undefined && [400, 401, 403, 404, 409, 422].includes(code);
      publish(!retry && declined ? { status: "declined", message: "The server declined this evidence. Review the source and current holding before trying again." }
        : { status: "uncertain", request, retryDenied: declined, message: declined ? "The earlier result remains unconfirmed. Refresh and reconcile the current holding before recording new evidence." : uncertain });
    }
  };
  const submit = async (kind: EvidenceKind, fields: EvidenceFields) => {
    if (!allowed || !operation || store.read().request) return;
    try {
      assertOperationLifetime(operation);
      const payload = Object.freeze(makeEvidencePayload(kind, bond, fields, generateIdempotencyKey()));
      const request = Object.freeze({ kind, bondId: bond.id, payload, body: JSON.stringify(payload), operation, scope });
      publish({ status: "submitting", request }); await dispatch(request, false);
    } catch (error) {
      if (operation.active) publish({ status: "declined", message: error instanceof Error ? error.message : "Review the evidence fields." });
    }
  };
  const retry = async () => {
    const current = store.read();
    if (current.status === "uncertain" && current.request && !current.retryDenied) await dispatch(current.request, true);
  };
  const begin = () => { if (allowed && !store.read().request) publish({ status: "idle" }); };
  return { allowed, scope, ...state, begin, submit, retry };
}
export type GrzEvidenceController = ReturnType<typeof useGrzEvidenceRecord>;
