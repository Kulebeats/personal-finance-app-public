/**
 * Recurring Investments Hooks
 *
 * TanStack Query hooks for recurring investment management (SIPs, auto-investments).
 *
 * @module hooks/investments/useRecurringInvestments
 */

import { useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/contexts/SessionContext";
import { apiRequest, type HttpError } from "../../lib/queryClient";
import { generateIdempotencyKey } from "@/lib/api";
import {
  assertOperationLifetime, captureOperationLifetime, StaleOperationError, subscribeOperationLifetimeRetirement,
  type OperationLifetime,
} from "@/lib/operation-lifetime";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import { readRecurringAcknowledgement, readRecurringList, type RecurringList } from "./recurringPlanResponse";
import type { RecurringInvestment } from "./types";

const recurringPath = "/api/investments/recurring";
const recurringKey = investmentKeys.recurring();

function useRecurringScope() {
  const { status, lifetime } = useSession();
  const queryClient = useQueryClient();
  const operation = lifetime?.operation;
  const ready = status?.state === "ready" && operation?.active === true && captureOperationLifetime() === operation &&
    operation.expectations?.subject === status.subject.id && operation.expectations.household === status.household.id &&
    lifetime?.client === queryClient;
  return { queryClient, operation: ready ? operation : null, role: ready ? status.household.role : null };
}

export function useRecurringInvestments() {
  const { operation } = useRecurringScope();
  return useQuery({
    queryKey: recurringKey,
    enabled: !!operation,
    // Another member can change a plan without delivering an invalidation to
    // this tab. Bound visible-list staleness and refresh when the tab returns.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
    queryFn: async (): Promise<RecurringList> => {
      if (!operation) throw new StaleOperationError();
      const response = await apiRequest("GET", recurringPath, undefined, operation);
      assertOperationLifetime(operation);
      const result: unknown = await response.json();
      assertOperationLifetime(operation);
      return readRecurringList(result, operation.expectations?.household);
    },
    select: (result) => result.data,
  });
}

interface CreateTerms {
  type: "sip" | "rollover";
  accountId: string;
  securityId: string;
  amount: string;
  currency: string;
  frequency: "monthly" | "quarterly" | "semi_annually" | "yearly";
  nextExecutionDate: string;
}
interface SourceLabels { account: string; instrument: string }
interface AuthorizeTerms extends Omit<CreateTerms, "type" | "frequency" | "nextExecutionDate"> {
  type: "sip";
  frequency: string;
  expectedRevision: number;
  initialExecutionDate: string;
}
type Command = { readonly operation: OperationLifetime } & (
  | { readonly kind: "create"; readonly body: Readonly<CreateTerms & { operationId: string }>; readonly labels: Readonly<SourceLabels> }
  | { readonly kind: "authorize"; readonly planId: string; readonly body: Readonly<AuthorizeTerms & { operationId: string }> }
  | { readonly kind: "deactivate"; readonly planId: string }
);
type PendingCommand = null | { kind: "create" } | { kind: "authorize" | "deactivate"; planId: string };
type State =
  | { status: "idle"; message?: string; messageKind?: Command["kind"] }
  | { status: "submitting"; command: Command }
  | { status: "uncertain"; command: Command; message: string; retryDenied: boolean };
const idle: State = { status: "idle" };

function createCommandStore() {
  let state: State = idle;
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
    // The SessionProvider withdraws the old tree. Clear its draft without
    // publishing a state transition from that retired lifetime.
    retire() { state = idle; listeners.clear(); },
  };
}

const stores = new WeakMap<OperationLifetime, ReturnType<typeof createCommandStore>>();
const unavailable = createCommandStore();
subscribeOperationLifetimeRetirement(operation => {
  stores.get(operation)?.retire();
  stores.delete(operation);
});

function storeFor(operation: OperationLifetime | null) {
  if (!operation?.active) return unavailable;
  let store = stores.get(operation);
  if (!store) {
    store = createCommandStore();
    stores.set(operation, store);
  }
  return store;
}

const unconfirmed = "The result is unconfirmed. Retry the same request before starting another action.";
const reviewCurrent = "The recurring plan or its source changed. Review the current terms before confirming again.";

async function sendCommand(command: Command): Promise<RecurringInvestment | null> {
  const { operation } = command;
  assertOperationLifetime(operation);
  const path = command.kind === "create" ? recurringPath : `${recurringPath}/${encodeURIComponent(command.planId)}`;
  try {
    const response = command.kind === "deactivate"
      ? await apiRequest("DELETE", path, undefined, operation)
      : await apiRequest("POST", command.kind === "authorize" ? `${path}/authorize` : path, command.body, operation);
    assertOperationLifetime(operation);
    const result: unknown = await response.json();
    assertOperationLifetime(operation);
    return readRecurringAcknowledgement(
      result, operation.expectations?.household, command.kind, command.kind === "create" ? undefined : command.planId,
    );
  } catch (error) {
    assertOperationLifetime(operation);
    throw error;
  }
}

export function useRecurringPlanCommands() {
  const { operation, queryClient, role } = useRecurringScope();
  const { toast } = useToast();
  const allowed = !!operation && (role === "owner" || role === "admin" || role === "member");
  const store = storeFor(allowed ? operation : null);
  const state = useSyncExternalStore(store.subscribe, store.read, store.read);
  const isCurrent = () => allowed && operation?.active === true && captureOperationLifetime() === operation;
  const owns = (command: Command) => {
    const current = store.read();
    return isCurrent() && command.operation === operation && current.status === "submitting" && current.command === command;
  };
  const listQuery = () => queryClient.getQueryCache().find<RecurringList>({ queryKey: recurringKey, exact: true });
  const currentPlan = (id: string) => {
    const state = listQuery()?.state;
    if (state?.status !== "success" || state.isInvalidated) return;
    return state.data?.data.find(plan => plan.id === id);
  };
  const refreshPlans = async (command: Command) => {
    const alreadyFetching = listQuery()?.state.fetchStatus === "fetching";
    // The tab may unmount while the write or an older list read is pending.
    // Refresh the existing query even when it has no observers.
    const filters = { queryKey: recurringKey, exact: true, refetchType: "all" as const };
    await queryClient.invalidateQueries(filters, { cancelRefetch: false });
    // An existing GET could have started before the write or refusal. Allow it
    // to settle, then start a new read without cancelling another observer.
    if (alreadyFetching && owns(command)) await queryClient.invalidateQueries(filters, { cancelRefetch: false });
  };

  const mutation = useMutation({
    mutationKey: [...recurringKey, "command"],
    mutationFn: sendCommand,
    retry: false,
    onMutate: () => {
      const query = listQuery();
      return { query, updateCount: query?.state.dataUpdateCount };
    },
    onSuccess: async (plan, command, observed) => {
      if (!owns(command)) return;
      const query = listQuery();
      // A completed GET may have returned a newer revision or removed a plan
      // after visibility changed. Only update the list observed at dispatch.
      if (plan && query && query === observed?.query && query.state.status === "success" &&
          query.state.fetchStatus === "idle" && query.state.dataUpdateCount === observed.updateCount) {
        queryClient.setQueryData<RecurringList>(recurringKey, previous => {
          if (!previous) return previous;
          const exists = previous.data.some(row => row.id === plan.id);
          return { ...previous, data: exists ? previous.data.map(row => row.id === plan.id ? plan : row) : [...previous.data, plan] };
        });
      }
      await refreshPlans(command);
      if (!owns(command)) return;
      toast({
        title: command.kind === "deactivate" ? "Plan deactivated" : command.kind === "authorize" ? "Authorization recorded" : "Recurring plan recorded",
      });
    },
  });

  const dispatch = async (command: Command, replay: boolean) => {
    store.publish({ status: "submitting", command });
    try {
      await mutation.mutateAsync(command);
      if (!owns(command)) return false;
      store.publish(idle);
      return isCurrent();
    } catch (error) {
      if (!owns(command)) return false;
      const failure = error as HttpError | null | undefined;
      const httpStatus = failure?.status, code = failure?.code;
      const sourceChanged = (httpStatus === 409 && code === "CONFLICT") ||
        (httpStatus === 404 && code === "NOT_FOUND") || (httpStatus === 403 && code === "FORBIDDEN");
      const invalid = httpStatus === 400 && code === "VALIDATION_ERROR";
      if (sourceChanged) {
        await refreshPlans(command);
        if (!owns(command)) return false;
      }
      if (!replay && (sourceChanged || invalid)) {
        store.publish({ status: "idle", messageKind: command.kind,
          message: sourceChanged ? reviewCurrent : "Review the plan terms before confirming again." });
      } else {
        const retryDenied = replay && (sourceChanged || invalid);
        store.publish({ status: "uncertain", command, retryDenied, message: retryDenied
          ? "The earlier result is still unconfirmed. Review the current plan and retry the original request if its source is available."
          : unconfirmed });
      }
      return false;
    }
  };

  const admit = (build: (origin: OperationLifetime) => Command): Promise<boolean> => {
    if (!operation || !isCurrent() || store.read().status !== "idle") return Promise.resolve(false);
    return dispatch(Object.freeze(build(operation)), false);
  };
  const retry = (kind?: Command["kind"]): Promise<boolean> => {
    const current = store.read();
    if (!isCurrent() || current.status !== "uncertain" || (kind && current.command.kind !== kind)) {
      return Promise.resolve(false);
    }
    return dispatch(current.command, true);
  };

  const create = (terms: CreateTerms, labels: SourceLabels) => admit(origin => ({
    kind: "create", operation: origin, labels: Object.freeze({ ...labels }),
    body: Object.freeze({ ...terms, operationId: generateIdempotencyKey() }),
  }));
  const authorize = (plan: RecurringInvestment) => {
    const current = currentPlan(plan.id);
    const securityId = plan.securityId;
    if (!current?.permittedActions.includes("authorize") || !securityId || plan.type !== "sip" ||
        plan.householdId !== operation?.expectations?.household ||
        current.authorizationRevision !== plan.authorizationRevision || current.isActive !== plan.isActive ||
        current.type !== plan.type || current.accountId !== plan.accountId || current.securityId !== plan.securityId ||
        current.amount !== plan.amount || current.currency !== plan.currency || current.frequency !== plan.frequency ||
        current.authorizationInitialExecutionDate !== plan.authorizationInitialExecutionDate ||
        (!plan.authorizationInitialExecutionDate && current.nextExecutionDate !== plan.nextExecutionDate)) return Promise.resolve(false);
    return admit(origin => ({
      kind: "authorize", operation: origin, planId: plan.id,
      body: Object.freeze({ operationId: generateIdempotencyKey(), expectedRevision: plan.authorizationRevision,
        type: "sip", accountId: plan.accountId, securityId, amount: plan.amount, currency: plan.currency,
        frequency: plan.frequency, initialExecutionDate: plan.authorizationInitialExecutionDate ?? plan.nextExecutionDate }),
    }));
  };
  const deactivate = (plan: RecurringInvestment) => {
    if (plan.householdId !== operation?.expectations?.household ||
        !currentPlan(plan.id)?.permittedActions.includes("deactivate")) return Promise.resolve(false);
    return admit(origin => ({ kind: "deactivate", operation: origin, planId: plan.id }));
  };

  const command = state.status === "idle" ? null : state.command;
  const pending: PendingCommand = command && (command.kind === "create" ? { kind: command.kind } : { kind: command.kind, planId: command.planId });
  const message = state.status === "idle" ? state.message ?? null : state.status === "uncertain" ? state.message : null;
  const messageKind = state.status === "idle" ? state.messageKind ?? null : command?.kind ?? null;
  return {
    allowed, pending, busy: state.status === "submitting", uncertain: state.status === "uncertain",
    retryDenied: state.status === "uncertain" && state.retryDenied, message, messageKind,
    authorize, deactivate, retry, create, isCurrent,
    createDraft: command?.kind === "create" ? { terms: command.body, labels: command.labels } : null,
  };
}

export function useCreateRecurringInvestment() {
  const commands = useRecurringPlanCommands();
  return { ...commands, retry: () => commands.retry("create") };
}
