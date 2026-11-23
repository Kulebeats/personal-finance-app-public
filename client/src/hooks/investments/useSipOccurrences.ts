import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { SipOccurrenceContractError, normalizeSipOccurrenceConfirmation } from "@shared/sip-occurrence-contract";
import { householdCalendarDate } from "@shared/household-calendar";
import { useSession } from "@/contexts/SessionContext";
import { generateIdempotencyKey, type ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  assertOperationLifetime, captureOperationLifetime, StaleOperationError, subscribeOperationLifetimeRetirement,
  type OperationLifetime,
} from "@/lib/operation-lifetime";
import { investmentKeys } from "./keys";
import {
  confirmSipOccurrence, listSipOccurrences, configureSipHouseholdCalendar, getSipHouseholdCalendar,
  type SipHouseholdCalendarResponse, type SipConfirmationDraft, type SipConfirmationRequest,
  type SipOccurrence, type SipOccurrenceList, type SipOccurrenceOptions, type SipPendingOccurrence,
} from "./sipOccurrenceApi";

const root = [...investmentKeys.recurring(), "occurrences"] as const;
const commandKey = [...investmentKeys.recurring(), "occurrence-command"] as const;
const calendarKey = [...investmentKeys.all, "calendar"] as const;
const unavailableDetails = "This occurrence is closed; execution details are unavailable.";
const calendarRequired = "Confirmation is unavailable until the household calendar is configured.";
type Fields = Record<string, string[]>;
type Token = Readonly<{ id: string; planId: string; scheduledDate: string }>;
type Draft = { occurrence: SipPendingOccurrence; terms: SipConfirmationDraft | SipConfirmationRequest };
type Command = Readonly<Draft & { terms: SipConfirmationRequest; serializedBody: string; operation: OperationLifetime; token: Token }>;
type OccurrenceRead = SipOccurrenceList & { readRevision: number };
type State = {
  status: "idle" | "submitting" | "uncertain";
  command: Command | null;
  draft: Draft | null;
  message: string | null;
  fields: Fields;
};
const idle = (): State => ({ status: "idle", command: null, draft: null, message: null, fields: {} });
const identity = (row: { planId: string; scheduledDate: string }) => `${row.planId}/${row.scheduledDate}`;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function createStore() {
  let state = idle();
  const listeners = new Set<() => void>();
  const fences = new Set<string>();
  const readRevisions = new Map<string, number>();
  const readRevision = (planId: string) => readRevisions.get(planId) ?? 0;
  const notify = () => listeners.forEach(listener => listener());
  return {
    fences,
    readRevision,
    refuseReads(planId: string) {
      readRevisions.set(planId, readRevision(planId) + 1);
      notify();
    },
    read: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: State) {
      state = next;
      notify();
    },
    retire() {
      state = idle();
      fences.clear();
      readRevisions.clear();
      notify();
      listeners.clear();
    },
  };
}
type Store = ReturnType<typeof createStore>;
const stores = new WeakMap<OperationLifetime, Store>();
const unavailable = createStore();
subscribeOperationLifetimeRetirement(operation => {
  stores.get(operation)?.retire();
  stores.delete(operation);
});
function storeFor(operation: OperationLifetime | null) {
  if (!operation?.active) return unavailable;
  let store = stores.get(operation);
  if (!store) {
    store = createStore();
    stores.set(operation, store);
  }
  return store;
}
function useScope() {
  const { status, lifetime } = useSession();
  const client = useQueryClient();
  const origin = lifetime?.operation;
  const ready = status?.state === "ready" && origin?.active && captureOperationLifetime() === origin &&
    origin.expectations?.subject === status.subject.id && origin.expectations.household === status.household.id && lifetime?.client === client;
  return { client, operation: ready ? origin : null, role: ready ? status.household.role : null };
}
function minimal(row: { planId: string; scheduledDate: string }) {
  return { planId: row.planId, scheduledDate: row.scheduledDate, state: "closed" as const, detailsAvailable: false as const };
}
function retireDetails(store: Store, client: QueryClient, row: { planId: string; scheduledDate: string }) {
  const key = identity(row);
  store.fences.add(key);
  const state = store.read();
  if ((state.command && identity(state.command.occurrence) === key) || (state.draft && identity(state.draft.occurrence) === key)) {
    store.publish({ ...idle(), message: unavailableDetails });
  }
  client.setQueriesData<SipOccurrenceList>({ queryKey: root }, previous => previous && ({
    ...previous, data: previous.data.map(item => identity(item) === key ? minimal(row) : item),
  }));
  for (const mutation of client.getMutationCache().getAll()) {
    const token: unknown = mutation.state.variables;
    if (mutation.options.mutationKey?.join("/") === commandKey.join("/") && isRecord(token) &&
        token.planId === row.planId && token.scheduledDate === row.scheduledDate) client.getMutationCache().remove(mutation);
  }
}
function protectList(store: Store, client: QueryClient, result: SipOccurrenceList) {
  for (const row of result.data) {
    if (!row.detailsAvailable) retireDetails(store, client, row);
  }
  return { ...result, data: result.data.map(row => store.fences.has(identity(row)) ? minimal(row) : row) };
}

export function useSipOccurrences(planId: string, options: SipOccurrenceOptions = {}) {
  const { client, operation } = useScope();
  const store = storeFor(operation);
  const readRevision = () => operation?.active && captureOperationLifetime() === operation
    ? store.readRevision(planId) : null;
  const currentRevision = useSyncExternalStore(store.subscribe, readRevision, readRevision);
  const canRead = currentRevision !== null && !!planId;
  const filters: SipOccurrenceOptions = { state: options.state ?? "all", limit: options.limit ?? 25, ...(options.before ? { before: options.before } : {}) };
  const query = useQuery<OccurrenceRead>({
    queryKey: [...root, planId, filters],
    enabled: canRead,
    staleTime: cached => cached.state.data?.readRevision === readRevision() ? 60_000 : 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
    queryFn: async () => {
      const startedAtRevision = readRevision();
      if (!operation || startedAtRevision === null) throw new StaleOperationError();
      try {
        const result = await listSipOccurrences(planId, filters, operation);
        assertOperationLifetime(operation);
        return { ...protectList(store, client, result), readRevision: startedAtRevision };
      } catch (error) {
        assertOperationLifetime(operation);
        const status = (error as ApiError | undefined)?.status;
        // The server may check access after a later request has succeeded.
        if (status === 401 || status === 403 || status === 404) {
          store.refuseReads(planId);
        }
        throw error;
      }
    },
  });
  // All pages for this plan must be read again after an access refusal.
  const detailsWithheld = !canRead || currentRevision !== (query.data?.readRevision ?? 0);
  return { ...query, canRead, detailsWithheld, data: detailsWithheld ? undefined : query.data };
}

function copyDraft(draft: SipConfirmationDraft | SipConfirmationRequest): SipConfirmationDraft {
  return {
    finalStatement: draft.finalStatement,
    outcome: draft.outcome,
    ...(draft.brokerReference === undefined ? {} : { brokerReference: draft.brokerReference }),
    fills: draft.fills.map(fill => ({ ...fill })),
  };
}
function freezeDraft(occurrence: SipPendingOccurrence, terms: SipConfirmationDraft | SipConfirmationRequest): Draft {
  const copied = copyDraft(terms);
  copied.fills.forEach(fill => Object.freeze(fill));
  Object.freeze(copied.fills);
  return { occurrence: { ...occurrence, planned: { ...occurrence.planned }, permittedActions: [...occurrence.permittedActions] },
    terms: Object.freeze(copied) };
}
function sameSnapshot(left: SipPendingOccurrence["planned"], right: SipPendingOccurrence["planned"]) {
  return left.accountId === right.accountId && left.securityId === right.securityId && left.amount === right.amount &&
    left.currency === right.currency && left.authorizedFrequency === right.authorizedFrequency && left.authorizedInitialDate === right.authorizedInitialDate;
}
function fieldMessages(error: unknown): Fields {
  if (error instanceof SipOccurrenceContractError) {
    return Object.fromEntries(error.fields.map(field => [field.path, [field.message]]));
  }
  const fields = (error as ApiError | undefined)?.fields;
  if (!isRecord(fields)) return {};
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string[]] =>
    Array.isArray(entry[1]) && entry[1].every(message => typeof message === "string")));
}

export function useSipOccurrenceCommands() {
  const { client, operation, role } = useScope();
  const allowed = !!operation && (role === "owner" || role === "admin" || role === "member");
  const store = storeFor(allowed ? operation : null);
  const state = useSyncExternalStore(store.subscribe, store.read, store.read);
  const { toast } = useToast();
  const current = () => allowed && operation?.active === true && captureOperationLifetime() === operation;
  const owns = (command: Command) => current() && command.operation === operation &&
    store.read().status === "submitting" && store.read().command === command && !store.fences.has(identity(command.occurrence));
  const mutation = useMutation({
    mutationKey: commandKey,
    retry: false,
    mutationFn: async (token: Token) => {
      const command = store.read().command;
      if (!command || command.token !== token || !owns(command)) throw new StaleOperationError();
      const result = await confirmSipOccurrence(token.planId, token.scheduledDate, command.terms, command.operation, command.serializedBody);
      if (!owns(command)) throw new StaleOperationError();
      if (!sameSnapshot(command.occurrence.planned, result.data.occurrence.planned)) {
        throw new Error("The confirmation acknowledgment could not be verified. Retry the original request.");
      }
      return result;
    },
  });
  const refresh = async (command: Command, financial = false) => {
    const fetching = client.getQueryCache().findAll({ queryKey: investmentKeys.recurring() }).some(query => query.state.fetchStatus === "fetching");
    const filters = { queryKey: investmentKeys.recurring(), refetchType: "all" as const };
    await client.invalidateQueries(filters, { cancelRefetch: false });
    if (fetching && owns(command)) await client.invalidateQueries(filters, { cancelRefetch: false });
    if (financial && owns(command)) {
      await Promise.all([
        client.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() }),
        client.invalidateQueries({ queryKey: investmentKeys.transactionsRoot() }),
        client.invalidateQueries({ queryKey: investmentKeys.portfolioSummaryRoot() }),
        client.invalidateQueries({ queryKey: ["accounts"] }),
        client.invalidateQueries({ queryKey: ["goals"] }),
      ]);
    }
  };
  const dispatch = async (command: Command, replay: boolean): Promise<boolean> => {
    store.publish({ status: "submitting", command, draft: command, message: null, fields: {} });
    try {
      const result = await mutation.mutateAsync(command.token);
      if (!owns(command)) return false;
      await refresh(command, true);
      if (!owns(command)) return false;
      store.publish(idle());
      toast({ title: result.data.occurrence.result.outcome === "unfilled" ? "Order closed without purchases" : "Actual purchases recorded" });
      return true;
    } catch (error) {
      if (!owns(command)) return false;
      const failure = error as ApiError;
      if (failure.status === 409 && failure.code === "OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE") {
        retireDetails(store, client, command.occurrence);
        await client.invalidateQueries({ queryKey: [...root, command.occurrence.planId], refetchType: "all" });
        return false;
      }
      if (failure.status === 409 && failure.code === "HOUSEHOLD_CALENDAR_REQUIRED") {
        store.publish({ status: "uncertain", command, draft: command, message: calendarRequired, fields: {} });
        return false;
      }
      const changed = [403, 404, 409].includes(failure.status ?? 0);
      const invalid = failure.status === 400 && failure.code === "VALIDATION_ERROR";
      if (changed) await refresh(command);
      if (!owns(command)) return false;
      const fields = fieldMessages(error);
      if (!replay && (changed || invalid)) {
        store.publish({ ...idle(), draft: freezeDraft(command.occurrence, command.terms), fields,
          message: changed ? "The occurrence or your access changed. Review the current record before confirming again." : "Review the final statement and fill values before confirming again." });
      } else {
        store.publish({ status: "uncertain", command, draft: command, fields,
          message: "The result is unconfirmed. Retry the original confirmation before starting another." });
      }
      return false;
    }
  };
  const verified = (occurrence: SipPendingOccurrence) => {
    if (!current() || store.fences.has(identity(occurrence))) return false;
    const readRevision = store.readRevision(occurrence.planId);
    const queries = client.getQueryCache().findAll({ queryKey: [...root, occurrence.planId] })
      .map(query => ({ query, data: query.state.data as OccurrenceRead | undefined }))
      .filter(frame => frame.data?.readRevision === readRevision && frame.data.data.some(row => identity(row) === identity(occurrence)))
      .sort((left, right) => right.query.state.dataUpdatedAt - left.query.state.dataUpdatedAt);
    const query = queries[0]?.query;
    if (queries.some(frame => frame.data?.data.some(item => identity(item) === identity(occurrence) && item.state === "closed"))) return false;
    const row: SipOccurrence | undefined = queries[0]?.data?.data.find(item => identity(item) === identity(occurrence));
    return query?.state.status === "success" && !query.state.isInvalidated && row?.state === "pending" && row.detailsAvailable &&
      row.occurrenceRevision === occurrence.occurrenceRevision && row.permittedActions.includes("confirm") && sameSnapshot(row.planned, occurrence.planned);
  };
  const confirm = (occurrence: SipPendingOccurrence, draft: SipConfirmationDraft): Promise<boolean> => {
    if (!operation || store.read().status !== "idle" || !verified(occurrence)) return Promise.resolve(false);
    let terms: SipConfirmationRequest;
    try {
      terms = normalizeSipOccurrenceConfirmation({ operationId: generateIdempotencyKey(), expectedRevision: occurrence.occurrenceRevision, ...copyDraft(draft) });
    } catch (error) {
      store.publish({ ...idle(), draft: freezeDraft(occurrence, draft), fields: fieldMessages(error),
        message: "Review the final statement and fill values before confirming." });
      return Promise.resolve(false);
    }
    const token = Object.freeze({ id: terms.operationId, planId: occurrence.planId, scheduledDate: occurrence.scheduledDate });
    const original = freezeDraft(occurrence, terms);
    return dispatch(Object.freeze({ ...original, terms, serializedBody: JSON.stringify(terms), token, operation }), false);
  };
  const retry = (): Promise<boolean> => {
    const pending = store.read();
    if (!current() || pending.status !== "uncertain" || !pending.command) return Promise.resolve(false);
    return dispatch(pending.command, true);
  };
  const setDraft = (occurrence: SipPendingOccurrence, draft: SipConfirmationDraft) => {
    if (!verified(occurrence) || store.read().status !== "idle") return;
    store.publish({ ...idle(), draft: freezeDraft(occurrence, draft) });
  };
  const clearDetails = (planId: string, scheduledDate: string) => {
    if (operation && current()) retireDetails(store, client, { planId, scheduledDate });
  };
  return {
    allowed, busy: state.status === "submitting", uncertain: state.status === "uncertain", message: state.message,
    fields: state.fields, draft: state.draft,
    pending: state.command ? { planId: state.command.occurrence.planId, scheduledDate: state.command.occurrence.scheduledDate } : null,
    confirm, retry, setDraft, clearDetails, isCurrent: current,
  };
}

export function useSipHouseholdCalendar() {
  const { client, operation } = useScope();
  const query = useQuery({
    queryKey: calendarKey,
    enabled: !!operation,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
    queryFn: () => {
      if (!operation) throw new StaleOperationError();
      return getSipHouseholdCalendar(operation);
    },
  });
  const [hint, setHint] = useState<{ operation: OperationLifetime; zone: string; date: string } | null>(null);
  const zone = query.data?.data.configured ? query.data.data.timeZone : null;
  useEffect(() => {
    if (!operation || !zone) {
      setHint(null);
      return;
    }
    let previous = householdCalendarDate(new Date(), zone);
    setHint({ operation, zone, date: previous });
    const timer = setInterval(() => {
      if (!operation.active || captureOperationLifetime() !== operation) return;
      const next = householdCalendarDate(new Date(), zone);
      if (next === previous) return;
      previous = next;
      setHint({ operation, zone, date: next });
      // Display-clock rollover is a refresh hint, never permission to post or
      // rewrite actual dates. The server validates its own locked calendar.
      void client.invalidateQueries({ queryKey: calendarKey });
      void client.invalidateQueries({ queryKey: root });
    }, 30_000);
    return () => clearInterval(timer);
  }, [client, operation, zone]);
  return { ...query, dayHint: hint?.operation === operation && hint.zone === zone ? hint.date : null };
}

export function useConfigureSipHouseholdCalendar() {
  const { client, operation, role } = useScope();
  const eligible = () => {
    const query = client.getQueryCache().find<SipHouseholdCalendarResponse>({ queryKey: calendarKey, exact: true });
    return role === "owner" && operation?.active && captureOperationLifetime() === operation && query?.state.status === "success" &&
      !query.state.isInvalidated && query.state.data?.data.permittedActions.includes("configure");
  };
  const mutation = useMutation({
    mutationKey: [...calendarKey, "configure"],
    retry: false,
    mutationFn: async (timeZone: string) => {
      if (!operation || !eligible()) throw new Error("Only the current household owner can configure the shared calendar.");
      return configureSipHouseholdCalendar(timeZone, operation);
    },
    onSuccess: async () => {
      if (!operation?.active || captureOperationLifetime() !== operation) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: calendarKey }),
        client.invalidateQueries({ queryKey: investmentKeys.recurring() }),
        client.invalidateQueries({ queryKey: ["household"] }),
        client.invalidateQueries({ queryKey: ["householdGeneral"] }),
        client.invalidateQueries({ queryKey: ["households"] }),
      ]);
    },
  });
  return { ...mutation, canConfigure: !!eligible() };
}
