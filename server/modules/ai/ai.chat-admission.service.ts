/**
 * R17 (17c/17d): one logical Thandi chat request, end to end.
 *
 *   consent (middleware) -> admit or replay (ledger, household lock; the
 *        actor's membership and consent rechecked before any replay body)
 *     -> processQuery with per-attempt claim (tenant share locks + consent
 *        recheck, then the cap lock), one more consent read right before the
 *        adapter call, and settlement
 *     -> complete in the exchange's own transaction, or settle the unpersisted
 *        outcome in the ledger's (unit consumed by an answer, refunded
 *        otherwise; cancelled -> failed), each with the query's audit row
 *
 * Every settlement and failure names the admission generation it belongs to
 * (Astra #255 r4): a stale settlement of an earlier admission of the same key
 * never touches the retry's reservation. Consent revocation blocks every claim
 * and dispatch that begins after it commits; a request already handed to the
 * provider completes.
 *
 * Quota is read back from the ledger after settlement, so the headers and
 * `remainingQueries` always describe the allowance that actually remains.
 *
 * @module ai/ai.chat-admission.service
 */
import { createHash, randomUUID } from "node:crypto";
import type { HouseholdContext } from "../../core/authz/implicit-household-context";
import { ConflictError } from "../../core/errors";
import {
  aiAdmissionRepository,
  type ActorScope,
  type AdmissionRef,
  type AIAdmissionRepository,
  type QuotaSnapshot,
} from "./ai.admission.repository";
import { assertOutboundStillPermitted, type HouseholdConsentState } from "./ai.consent-policy";
import { trackInFlight } from "./ai.inflight";
import type { AIService, ChatAdmissionControls } from "./ai.service";
import type { ChatResponse } from "./ai.types";

export interface ChatAdmissionInput {
  actor: HouseholdContext;
  message: string;
  conversationId?: string;
  clientRequestKey?: string;
  consent: HouseholdConsentState;
  ipAddress?: string;
  /** Aborted on client disconnect (P2-2). */
  signal?: AbortSignal;
}

export interface ChatAdmissionOutcome {
  response: ChatResponse;
  quota: QuotaSnapshot;
  replayed: boolean;
}

/** Canonical payload identity: the same key may only ever mean this payload. */
export function chatFingerprint(message: string, conversationId: string | undefined): string {
  return createHash("sha256").update(JSON.stringify({ message, conversationId: conversationId ?? null })).digest("hex");
}

export class AIChatAdmissionService {
  constructor(
    private readonly service: AIService,
    private readonly ledger: AIAdmissionRepository = aiAdmissionRepository,
  ) {}

  async chat(input: ChatAdmissionInput): Promise<ChatAdmissionOutcome> {
    const { householdId, userId } = input.actor;
    const admission = await this.ledger.admit({
      householdId,
      actorId: userId,
      clientRequestKey: input.clientRequestKey ?? `server-${randomUUID()}`,
      fingerprint: chatFingerprint(input.message, input.conversationId),
      consentVersion: input.consent.version,
    });
    if (admission.kind === "replay") {
      return { response: admission.response, quota: await this.ledger.readQuota(householdId), replayed: true };
    }

    const ref: AdmissionRef = { requestId: admission.requestId, generation: admission.generation };
    const scope: ActorScope = { householdId, actorId: userId };
    const controls = this.controlsFor(ref, scope, admission, input);
    // Aborted by the client's disconnect, or by a revocation or erasure in
    // this process (R17 follow-up); the fences catch one from elsewhere.
    const inFlight = trackInFlight(householdId, userId, input.signal);
    let response: ChatResponse;
    try {
      response = await this.service.processQuery({
        userId,
        householdId,
        actor: input.actor,
        message: input.message,
        conversationId: input.conversationId,
        ipAddress: input.ipAddress,
        admission: controls,
        signal: inFlight.signal,
      });
    } catch (error) {
      await this.ledger.fail(ref);
      throw error;
    } finally {
      inFlight.release();
    }
    // processQuery settles every outcome with its audit row: an answer in its
    // exchange's transaction, anything else through `settleUnpersisted`. A
    // later disconnect never reopens a settled request. This call is the
    // backstop for a request still open here: a cancelled one fails, so a
    // same-key retry runs again. A settlement that throws refunds the unit
    // and frees the key rather than leaving it open.
    try {
      await this.ledger.settleOutcome(ref, scope, { cancelled: inFlight.signal.aborted, response });
    } catch (error) {
      await this.ledger.fail(ref);
      throw error;
    }
    return { response, quota: await this.ledger.readQuota(householdId), replayed: false };
  }

  private controlsFor(
    ref: AdmissionRef,
    scope: ActorScope,
    prior: { attemptOffset: number; priorPaidCalls: number },
    input: ChatAdmissionInput,
  ): ChatAdmissionControls {
    const { attemptOffset, priorPaidCalls } = prior;
    const { householdId, userId } = input.actor;
    const current = input.consent.standing === "current";
    return {
      requestId: ref.requestId,
      priorPaidCalls,
      consentVersion: input.consent.version,
      externalProvidersAllowed: current,
      externalBlockedReason: current ? null : "consent_outdated",
      // Consent and membership are checked under the claim's cap lock, in the
      // claim's transaction, so nothing committed while it waited is missed.
      beforeAttempt: (attempt) =>
        this.ledger.claimAttempt(ref, { ...attempt, ordinal: attemptOffset + attempt.ordinal }, (tx, beforeLock) =>
          assertOutboundStillPermitted(householdId, userId, input.consent.version, tx, beforeLock),
        ),
      // One indexed read after the claim committed, right before the adapter
      // call: no lock is held across the provider call (Astra #255 r4).
      beforeDispatch: () => assertOutboundStillPermitted(householdId, userId, input.consent.version),
      // Settled by the claimed row's own id, which survives erasure detaching it.
      afterAttempt: async (record) => {
        if (record.attemptId) await this.ledger.settleAttempt(record.attemptId, record);
      },
      // A completion that settled nothing (a newer admission owns the key)
      // rolls the exchange and its audit back (Astra #255 r4).
      completeExchange: async (tx, response, options) => {
        if (!(await this.ledger.completeWith(tx, ref, response, options))) {
          throw new ConflictError("This request was already settled by another admission.");
        }
      },
      settleUnpersisted: (outcome, onSettled) => this.ledger.settleOutcome(ref, scope, outcome, onSettled),
    };
  }
}
