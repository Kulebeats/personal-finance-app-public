import { useCallback, useEffect, useRef, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import { useSession } from "@/contexts/SessionContext";
import { apiCall, generateIdempotencyKey, type ApiError } from "@/lib/api";
import { budgetKeys } from "@/hooks/useBudgets";
import { assertOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import type { BudgetRecalculationPreview } from "@shared/budget-recalculation-preview";
import { previewMonths, previewMonthLabel, validateBudgetPreview, validateBudgetApplication, type ConfirmedBudgetApplication } from "../previewContract";

interface PreviewState {
  operation: OperationLifetime | null;
  open: boolean;
  status: "idle" | "checking" | "ready" | "error" | "applied";
  selected: number[];
  confirming: boolean;
  data?: BudgetRecalculationPreview;
  message?: string;
  application?: { status: "submitting" | "uncertain"; request: ConfirmedBudgetApplication; body: string; retryDenied?: boolean };
  rechecking?: boolean;
}
const empty = (operation: OperationLifetime | null, open = false): PreviewState => ({ operation, open, status: "idle", selected: [], confirming: false });
const uncertainMessage = "We could not confirm whether the earlier changes were applied. Recheck current budgets before attempting new changes.";

/** Page-owned, lifetime-bound operation; retired financial display never backs a retry. */
export function useBudgetRecalculationPreview(settingsOpen: boolean) {
  const { lifetime, status } = useSession();
  const operation = lifetime?.operation ?? null, key = lifetime?.key ?? null;
  const allowed = status?.state === "ready" && operation !== null && operation.active;
  const canWrite = status?.state === "ready" && ["owner", "admin", "member"].includes(status.household.role);
  const origin = useRef({ operation, key, allowed, canWrite, client: lifetime?.client, open: false, epoch: 0, mounted: true });
  Object.assign(origin.current, { operation, key, allowed, canWrite, client: lifetime?.client });
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<PreviewState>(() => empty(operation));
  const latest = useRef(state);
  // Synchronous publication also blocks a second click before React rerenders.
  const publish = useCallback((next: PreviewState) => { latest.current = next; setState(next); }, []);

  const cancel = useCallback(() => { ++origin.current.epoch; controller.current?.abort(); controller.current = null; }, []);
  const load = useCallback(async () => {
    if (latest.current.application) return;
    cancel();
    const current = origin.current, captured = current.operation, identity = current.key, epoch = current.epoch;
    if (!current.open || !current.allowed || !current.canWrite || !captured || !identity) return;
    publish({ ...empty(captured, true), status: "checking" });
    // A paused renewal cannot retain earlier financial rows. Online recovery
    // starts another request, rather than accepting an older cached result.
    if (!onlineManager.isOnline()) return;
    const request = new AbortController(); controller.current = request;
    const fresh = () => {
      const now = origin.current;
      if (!now.mounted || !now.open || !now.allowed || now.operation !== captured || now.key !== identity || now.epoch !== epoch || request.signal.aborted) return false;
      try { assertOperationLifetime(captured); return true; } catch { return false; }
    };
    try {
      assertOperationLifetime(captured);
      const result = await apiCall<{ success: boolean; data: unknown }>(`/budgets/recalculate/preview?months=${previewMonths}`,
        { method: "GET", signal: request.signal }, false, false, captured);
      if (!fresh()) return;
      if (result.success !== true) throw new Error("Unverified preview response");
      const data = validateBudgetPreview(result.data);
      if (fresh()) publish({ ...empty(captured, true), status: "ready", data });
    } catch (error) {
      if (!fresh()) return;
      const message = (error as ApiError).status === 404
        ? "Budget preview is unavailable on this server. Your budgets have not changed."
        : "Unable to verify budget suggestions. Refresh preview to try again. Your budgets have not changed.";
      publish({ ...empty(captured, true), status: "error", message });
    }
  }, [cancel, publish]);

  const changeSelection = useCallback((index: number, checked: boolean) => {
    const current = latest.current;
    if (!origin.current.allowed || !origin.current.canWrite || current.operation !== origin.current.operation || current.status !== "ready" ||
      current.confirming || current.application || !current.data?.suggestions[index]) return;
    const selected = current.selected.filter(value => value !== index);
    if (checked) selected.push(index);
    publish({ ...current, selected });
  }, [publish]);
  const reviewSelection = useCallback((confirming: boolean) => {
    const current = latest.current;
    if (!origin.current.allowed || !origin.current.canWrite || current.operation !== origin.current.operation || current.status !== "ready" ||
      !current.selected.length || current.application) return;
    publish({ ...current, confirming });
  }, [publish]);

  const apply = useCallback(async () => {
    const current = latest.current, captured = origin.current.operation, identity = origin.current.key, client = origin.current.client;
    if (!origin.current.allowed || !origin.current.canWrite || !captured || !identity || !client || current.operation !== captured ||
      current.application?.status === "submitting" || current.application?.retryDenied || current.rechecking) return;
    const retry = current.application?.status === "uncertain";
    if (!retry && (current.status !== "ready" || !current.confirming || !current.data || !current.selected.length)) return;
    try { assertOperationLifetime(captured); } catch { return; }
    const request: ConfirmedBudgetApplication = current.application?.request ?? { operationId: generateIdempotencyKey(), months: previewMonths,
      targetPeriod: current.data!.targetPeriod, suggestions: current.data!.suggestions.filter((_, index) => current.selected.includes(index)) };
    const body = current.application?.body ?? JSON.stringify(request);
    // Keep only the confirmed selected payload. Names, unselected history, and
    // all preview display values retire as soon as the operation is submitted.
    publish({ ...empty(captured, current.open), application: { status: "submitting", request, body } });
    const fresh = () => {
      const now = origin.current;
      if (!now.mounted || !now.allowed || now.operation !== captured || now.key !== identity || latest.current.application?.request !== request) return false;
      try { assertOperationLifetime(captured); return true; } catch { return false; }
    };
    try {
      if (!onlineManager.isOnline()) throw new Error("Offline before sending confirmed changes");
      const result = await apiCall<unknown>("/budgets/recalculate/apply", { method: "POST", body }, false, false, captured);
      if (!fresh()) return;
      validateBudgetApplication(result, request);
      if (!fresh()) return;
      publish({ ...empty(captured, origin.current.open), status: "applied",
        message: `Applied ${request.suggestions.length} budget ${request.suggestions.length === 1 ? "change" : "changes"} for ${previewMonthLabel(request.targetPeriod)}.` });
      void client.invalidateQueries({ queryKey: budgetKeys.all });
    } catch (error) {
      if (!fresh()) return;
      const code = (error as ApiError).status;
      if (!retry && code !== undefined && [400, 401, 403, 404, 409, 422].includes(code)) {
        publish({ ...empty(captured, origin.current.open), status: "error",
          message: "The server declined this request. Refresh preview and review fresh suggestions before confirming again." });
      } else {
        publish({ ...empty(captured, origin.current.open), message: uncertainMessage,
          application: { status: "uncertain", request, body, retryDenied: code === 403 } });
      }
    }
  }, [publish]);

  const recheck = useCallback(async () => {
    const current = latest.current, captured = origin.current.operation, identity = origin.current.key, client = origin.current.client;
    const application = current.application;
    if (!origin.current.allowed || !captured || !identity || !client || current.operation !== captured ||
      application?.status !== "uncertain" || current.rechecking) return;
    const fresh = () => {
      const now = origin.current;
      if (!now.mounted || !now.allowed || now.operation !== captured || now.key !== identity || latest.current.application?.request !== application.request) return false;
      try { assertOperationLifetime(captured); return true; } catch { return false; }
    };
    if (!fresh()) return;
    publish({ ...current, rechecking: true });
    try {
      const [year, month] = application.request.targetPeriod.split("-");
      const result = await apiCall<{ success: boolean; data: unknown }>(`/budgets/progress?year=${year}&month=${month}`,
        { method: "GET", cache: "no-store" }, false, false, captured);
      if (!fresh()) return;
      if (result.success !== true || !Array.isArray(result.data)) throw new Error("Unverified current budget response");
      publish({ ...latest.current, rechecking: false, message: `Current budgets were refreshed. ${uncertainMessage}` });
      void client.invalidateQueries({ queryKey: budgetKeys.all });
    } catch (error) {
      if (!fresh()) return;
      publish({ ...latest.current, rechecking: false, message: `Unable to refresh current budgets. ${uncertainMessage}`,
        application: { ...application, retryDenied: application.retryDenied || (error as ApiError).status === 403 } });
    }
  }, [publish]);
  const onOpenChange = useCallback((open: boolean) => {
    cancel(); origin.current.open = open && origin.current.allowed;
    if (latest.current.application && latest.current.operation === origin.current.operation) {
      const { application, message, rechecking } = latest.current;
      publish({ ...empty(origin.current.operation, origin.current.open), application, message, rechecking });
    } else if (origin.current.open) void load();
    else publish(empty(origin.current.operation));
  }, [cancel, load, publish]);

  useEffect(() => {
    cancel(); origin.current.open = false;
    publish(empty(operation));
  }, [operation, key, allowed, cancel, publish]);
  useEffect(() => { if (!settingsOpen) onOpenChange(false); }, [settingsOpen, onOpenChange]);
  useEffect(() => {
    if (canWrite || latest.current.operation !== operation) return;
    cancel();
    const { application, rechecking } = latest.current;
    publish({ ...empty(operation, origin.current.open), application, rechecking, message: application ? uncertainMessage : undefined });
  }, [canWrite, operation, cancel, publish]);
  useEffect(() => {
    origin.current.mounted = true;
    const renew = () => { if (origin.current.open) void load(); };
    const unsubscribe = onlineManager.subscribe(renew);
    window.addEventListener("focus", renew);
    return () => { origin.current.mounted = false; unsubscribe(); window.removeEventListener("focus", renew); cancel(); origin.current.open = false; };
  }, [cancel, load]);

  const visible = allowed && state.operation === operation;
  return { allowed, open: visible && state.open, status: visible ? state.status : "idle", data: visible ? state.data : undefined,
    message: visible ? state.message : undefined, selected: visible ? state.selected : [], confirming: visible && state.confirming,
    applicationStatus: visible ? state.application?.status : undefined, canApply: allowed && canWrite,
    canRetry: allowed && canWrite && !state.application?.retryDenied, rechecking: visible && state.rechecking,
    changeSelection, reviewSelection, apply, recheck, onOpenChange, refresh: load };
}

export type BudgetPreviewController = ReturnType<typeof useBudgetRecalculationPreview>;
