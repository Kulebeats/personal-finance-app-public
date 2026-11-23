/**
 * R17 (17c): durable admission ledger for Thandi chat.
 *
 * Postgres is the quota authority (never an evictable cache counter). Every
 * admission for a household runs under that household row's lock, so two
 * instances cannot both admit the last unit or the same logical request. No
 * transaction is held across a provider call: admission, each attempt claim,
 * each attempt settlement and the final outcome are separate short writes.
 * Every settlement and failure names the admission generation it belongs to
 * (Astra #255 r4): a re-admission bumps it, so a stale worker matches nothing.
 *
 * @module ai/ai.admission.repository
 */
import { and, eq, gt, gte, inArray, max, min, count, ne, sql } from "drizzle-orm";
import { aiAttempts, aiRequests, households } from "@shared/schema";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { ConflictError, ForbiddenError, RateLimitError } from "../../core/errors";
import { logger } from "../../utils/logger";
import { ActorRemovedError, assertAdmissionStillPermitted, ConsentRevokedError, lockActorStanding, type BeforeLock } from "./ai.consent-policy";
import { fixedNonAnswer } from "./ai.non-answers";
import type { AttemptTicket, StageAttemptRecord } from "./ai.provider-orchestrator";
import { ProviderError, type AIStage, type AIProviderId, type AnswerMode } from "./ai.provider.types";
import { AI_PROVIDER_CAP_WINDOW_MS, getProviderCallCap, MIN_AI_CALL_TIMEOUT_MS } from "./ai.provider-config";
import type { ChatResponse } from "./ai.types";

export const AI_CHAT_QUOTA_LIMIT = 50;
export const AI_CHAT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

const COUNTED_QUOTA_STATES = ["reserved", "consumed"] as const;
const UNIQUE_VIOLATION = "23505";
const LOCK_NOT_AVAILABLE = "55P03";
/** Failures after a possible dispatch whose provider charge is unknowable. */
const UNKNOWN_USAGE_CATEGORIES = new Set(["timeout", "connection", "cancelled"]);

export interface QuotaSnapshot {
  limit: number;
  used: number;
  remaining: number;
  resetAt: Date;
}

/** A 429 that carries the ledger's quota so the response is self-describing. */
export class AiQuotaExceededError extends RateLimitError {
  readonly quota: QuotaSnapshot;

  constructor(quota: QuotaSnapshot, now: number) {
    super(Math.max(1, Math.ceil((quota.resetAt.getTime() - now) / 1000)));
    this.quota = quota;
  }
}

export interface AdmissionInput {
  householdId: string;
  actorId: string;
  clientRequestKey: string;
  fingerprint: string;
  consentVersion: string | null;
}

/** One admission of a request: settlements and failures must match both fields. */
export interface AdmissionRef {
  requestId: string;
  generation: number;
}

/** Whose request a settlement belongs to, for the erasure fence. */
export interface ActorScope {
  householdId: string;
  actorId: string;
}

export type AdmissionResult =
  | ({ kind: "admitted"; attemptOffset: number; priorPaidCalls: number } & AdmissionRef)
  | { kind: "replay"; requestId: string; response: ChatResponse };

type RequestRow = typeof aiRequests.$inferSelect;
type Executor = TransactionType | typeof db;

async function readQuotaWith(executor: Executor, householdId: string, now: number): Promise<QuotaSnapshot> {
  const [row] = await executor
    .select({ used: count(), oldest: min(aiRequests.createdAt) })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.householdId, householdId),
        gt(aiRequests.createdAt, new Date(now - AI_CHAT_QUOTA_WINDOW_MS)),
        inArray(aiRequests.chatQuotaState, [...COUNTED_QUOTA_STATES]),
      ),
    );
  const used = Number(row?.used ?? 0);
  const resetAt = row?.oldest ? new Date(row.oldest.getTime() + AI_CHAT_QUOTA_WINDOW_MS) : new Date(now + AI_CHAT_QUOTA_WINDOW_MS);
  return { limit: AI_CHAT_QUOTA_LIMIT, used, remaining: Math.max(0, AI_CHAT_QUOTA_LIMIT - used), resetAt };
}

/**
 * A re-admitted request continues its attempt ordinals and keeps the paid
 * calls it already made (Astra #255 r3, B1). A claim confirmed never to have
 * dispatched is not a paid call (Astra #255 r4).
 */
async function priorAttempts(tx: TransactionType, requestId: string): Promise<{ attemptOffset: number; priorPaidCalls: number }> {
  const [row] = await tx
    .select({
      last: max(aiAttempts.ordinal),
      paid: sql<string>`count(*) filter (where ${aiAttempts.status} <> 'not_dispatched')`,
    })
    .from(aiAttempts)
    .where(eq(aiAttempts.requestId, requestId));
  return { attemptOffset: row?.last ?? 0, priorPaidCalls: Number(row?.paid ?? 0) };
}

function replayOrConflict(existing: RequestRow, fingerprint: string): AdmissionResult | null {
  if (existing.fingerprint !== fingerprint) {
    throw new ConflictError("This request key was already used for a different request.");
  }
  if (existing.status === "in_progress") {
    throw new ConflictError("This request is already being processed.");
  }
  if (existing.status === "failed") return null;
  if (existing.responseBody === null) {
    throw new ConflictError("This request already completed and its conversation was deleted.");
  }
  return { kind: "replay", requestId: existing.id, response: existing.responseBody as ChatResponse };
}

export class AIAdmissionRepository {
  constructor(private readonly clock: () => number = Date.now) {}

  readQuota(householdId: string): Promise<QuotaSnapshot> {
    return readQuotaWith(db, householdId, this.clock());
  }

  /**
   * Admit one logical request, replay its stored outcome, or refuse it.
   * Membership and consent are rechecked under the household lock before any
   * stored body is read (Astra #255 r4): a member removed after the request
   * guard ran gets the non-member refusal, not a replayed answer.
   * A failed request with the same key and payload is re-admitted (its unit
   * was already refunded) under the next generation, keeping its attempt
   * ordinals unique.
   */
  admit(input: AdmissionInput): Promise<AdmissionResult> {
    const now = this.clock();
    return withTransaction(async (tx) => {
      const [household] = await tx
        .select({ id: households.id, given: households.aiConsentGiven, version: households.aiConsentVersion })
        .from(households)
        .where(eq(households.id, input.householdId))
        .for("no key update");
      if (!household) throw new ForbiddenError("Household not found");
      await assertAdmissionStillPermitted(tx, household, input.actorId);

      const [existing] = await tx
        .select()
        .from(aiRequests)
        .where(
          and(
            eq(aiRequests.householdId, input.householdId),
            eq(aiRequests.actorId, input.actorId),
            eq(aiRequests.clientRequestKey, input.clientRequestKey),
          ),
        )
        .for("update");
      if (existing) {
        const replay = replayOrConflict(existing, input.fingerprint);
        if (replay) return replay;
      }

      const quota = await readQuotaWith(tx, input.householdId, now);
      if (quota.used >= quota.limit) throw new AiQuotaExceededError(quota, now);

      if (existing) {
        const generation = existing.generation + 1;
        await tx
          .update(aiRequests)
          .set({
            status: "in_progress",
            generation,
            chatQuotaState: "reserved",
            consentVersion: input.consentVersion,
            answerMode: null,
            responseBody: null,
            completedAt: null,
            createdAt: new Date(now),
          })
          .where(and(eq(aiRequests.id, existing.id), eq(aiRequests.status, "failed")));
        return { kind: "admitted", requestId: existing.id, generation, ...(await priorAttempts(tx, existing.id)) };
      }

      const [created] = await tx
        .insert(aiRequests)
        .values({ ...input, status: "in_progress", chatQuotaState: "reserved", createdAt: new Date(now) })
        .returning({ id: aiRequests.id, generation: aiRequests.generation });
      return { kind: "admitted", requestId: created.id, generation: created.generation, attemptOffset: 0, priorPaidCalls: 0 };
    });
  }

  /**
   * Record the answer inside the caller's transaction (the exchange write), so
   * the persisted exchange and its settlement commit together. The unit is
   * consumed by any answer and refunded by an unavailable one. `storeReplay`
   * false keeps no replayable body (the thread it was asked in is gone); an
   * "unavailable" body is always the fixed non-answer (Astra #255 r4).
   * Applied at most once, and only to the admission it names; returns whether
   * this call settled the request.
   */
  async completeWith(
    tx: TransactionType,
    ref: AdmissionRef,
    response: ChatResponse,
    options: { storeReplay: boolean; linkConversation?: boolean },
  ): Promise<boolean> {
    const link = options.linkConversation ?? true;
    const stored = response.answerMode === "unavailable" ? fixedNonAnswer(response.reply) : response;
    const settled = await tx
      .update(aiRequests)
      .set(completionValues({
        mode: response.answerMode,
        body: options.storeReplay ? stored : null,
        conversationId: link ? response.conversationId || null : null,
      }, new Date(this.clock())))
      .where(openRequest(ref))
      .returning({ id: aiRequests.id });
    return settled.length > 0;
  }

  /**
   * Settle a request after processing returned. A request already completed
   * with its exchange stays completed: a disconnect after that commit never
   * reopens it. Otherwise a cancelled request fails (refunded, retryable) and
   * any other outcome completes. This path settles an answer whose exchange
   * was NOT persisted, so it never links a conversation: the thread the
   * client supplied may be gone, and a dangling id would fail the foreign key.
   * Only an "unavailable" outcome keeps a replay body, the fixed non-answer
   * (Astra #255 r3); any other answer here failed to persist and is not
   * stored for replay (Astra r2).
   * Astra #255 r4: the household, then the actor's membership, then the
   * request are locked, the order erasure takes them, and `onSettled` (the
   * query's audit row) learns whether the actor is still a member, so an
   * erased actor's audit carries no question or answer text.
   */
  async settleOutcome(
    ref: AdmissionRef,
    scope: ActorScope,
    outcome: { cancelled: boolean; response: ChatResponse },
    onSettled?: (tx: TransactionType, settlement: { actorRemoved: boolean }) => Promise<void>,
  ): Promise<void> {
    await withTransaction(async (tx) => {
      const standing = await lockActorStanding(tx, scope.householdId, scope.actorId);
      if (standing === "household_gone") return;
      const [row] = await tx.select({ id: aiRequests.id }).from(aiRequests).where(openRequest(ref)).for("update");
      if (!row) return;
      // R17 follow-up: a revocation that committed while the call was out
      // discards its result; the caller fails the request (refunded).
      if (standing === "consent_revoked") throw new ConsentRevokedError();
      // A removed actor's cancelled request (the erasure aborts it) or answer is
      // refused too; a plain non-answer settles below with a content-free audit.
      if (standing === "removed" && (outcome.cancelled || outcome.response.answerMode !== "unavailable")) {
        throw new ActorRemovedError();
      }
      if (outcome.cancelled) {
        await tx.update(aiRequests).set(failureValues(new Date(this.clock()))).where(openRequest(ref));
      } else {
        const storeReplay = outcome.response.answerMode === "unavailable";
        await this.completeWith(tx, ref, outcome.response, { storeReplay, linkConversation: false });
      }
      await onSettled?.(tx, { actorRemoved: standing === "removed" });
    });
  }

  /** A request that produced no answer: refund its unit exactly once. */
  async fail(ref: AdmissionRef): Promise<void> {
    const settled = await db
      .update(aiRequests)
      .set(failureValues(new Date(this.clock())))
      .where(openRequest(ref))
      .returning({ id: aiRequests.id });
    if (settled.length === 0) logger.warn("AI request already settled; failure ignored", { requestId: ref.requestId });
  }

  /**
   * Claim an attempt before dispatch, inside the paid-call cap. The cap is
   * per provider and configured model over a rolling window; claims for the
   * same pair serialise on an advisory lock so two instances cannot both take
   * the last call. No cap, or a reached cap, refuses with a typed, undispatched
   * ProviderError (unconfigured / billing) that the orchestrator labels.
   * `authorize` runs FIRST, in the claim's transaction, and takes the tenant's
   * share locks (household, membership) before the advisory lock: a consent
   * revoke or membership removal then waits for this claim instead of slipping
   * past it, and a claim stalled on one household's row never holds the cap
   * lock that other households' claims for the same model need. Each lock wait
   * is bounded by what is left of the request deadline (Astra #255 r4). Only
   * the admission that owns the request may claim for it.
   * A second claim of one attempt never dispatches.
   */
  async claimAttempt(
    ref: AdmissionRef,
    attempt: {
      stage: AIStage;
      ordinal: number;
      provider: AIProviderId;
      model: string | null;
      timeoutMs: number;
      /** The request deadline (epoch ms); the claim never waits or dispatches past it. */
      requestDeadlineAt?: number;
    },
    authorize?: (tx: TransactionType, beforeLock: BeforeLock) => Promise<void>,
  ): Promise<AttemptTicket> {
    const cap = getProviderCallCap(attempt.provider);
    if (cap === null) throw capRefusal(attempt.provider, "unconfigured", "No call cap is configured for this provider.");
    try {
      return await withTransaction(async (tx) => {
        const beforeLock = () => this.boundLockWait(tx, attempt.provider, attempt.requestDeadlineAt);
        await beforeLock();
        await authorize?.(tx, beforeLock);
        await assertOwnAdmission(tx, ref);
        await beforeLock();
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-call-cap:${attempt.provider}:${attempt.model ?? ""}`}))`);
        // Stamped once the locks are held: a call never ages out of the
        // rolling cap early because its claim waited (Astra #255 r3).
        const claimedAt = this.clock();
        if (attempt.requestDeadlineAt !== undefined && attempt.requestDeadlineAt - claimedAt < MIN_AI_CALL_TIMEOUT_MS) {
          throw deadlineRefusal(attempt.provider);
        }
        const used = await countProviderCalls(tx, attempt.provider, attempt.model, new Date(claimedAt - AI_PROVIDER_CAP_WINDOW_MS));
        if (used >= cap) throw capRefusal(attempt.provider, "billing", "The provider's call cap for this period is reached.");
        const callDeadline = claimedAt + attempt.timeoutMs;
        const [claimed] = await tx.insert(aiAttempts).values({
          requestId: ref.requestId,
          stage: attempt.stage,
          ordinal: attempt.ordinal,
          provider: attempt.provider,
          model: attempt.model,
          status: "dispatched",
          dispatchedAt: new Date(claimedAt),
          deadlineAt: new Date(Math.min(callDeadline, attempt.requestDeadlineAt ?? callDeadline)),
        }).returning({ id: aiAttempts.id });
        return { attemptId: claimed.id };
      });
    } catch (error) {
      const code = postgresCode(error);
      if (code === UNIQUE_VIOLATION) throw new ConflictError("This provider attempt was already claimed.");
      if (code === LOCK_NOT_AVAILABLE) throw deadlineRefusal(attempt.provider);
      throw error;
    }
  }

  /**
   * Bound the NEXT lock wait to what is left of the request deadline. Run
   * before each locking statement, so successive waits together never pass
   * the absolute deadline (Astra #255 r4).
   */
  private async boundLockWait(tx: TransactionType, provider: AIProviderId, requestDeadlineAt: number | undefined): Promise<void> {
    if (requestDeadlineAt === undefined) return;
    const waitMs = Math.floor(requestDeadlineAt - this.clock() - MIN_AI_CALL_TIMEOUT_MS);
    if (waitMs <= 0) throw deadlineRefusal(provider);
    await tx.execute(sql.raw(`set local lock_timeout = ${waitMs}`));
  }

  /** Paid calls for a provider + model in the rolling window (a never-dispatched claim is not one). */
  async readProviderCalls(provider: AIProviderId, model: string | null, now = this.clock()): Promise<number> {
    return countProviderCalls(db, provider, model, new Date(now - AI_PROVIDER_CAP_WINDOW_MS));
  }

  /**
   * Settle a claimed attempt once, by its own id (Astra #255 r3: a household
   * erasure detaches the row from its request, and the id still finds it);
   * a duplicate settlement is a no-op. The claimed `model` is the cap and
   * health accounting key and is never rewritten; the provider's reported
   * model goes to `reported_model`. A claim confirmed never to have reached
   * the provider settles `not_dispatched` (Astra #255 r4); one left
   * `dispatched` by a crash is still counted.
   * An attempt whose actor was erased while it was in flight keeps its usage
   * but never gets a provider request id: the flag is on the row itself, so a
   * settlement that waited on the erasure's row lock re-checks it.
   */
  async settleAttempt(attemptId: string, record: StageAttemptRecord): Promise<void> {
    await db
      .update(aiAttempts)
      .set({
        status: attemptStatus(record),
        failureCategory: record.category,
        providerRequestId: sql`case when ${aiAttempts.identityErased} then null else ${record.providerRequestId}::varchar end`,
        reportedModel: record.model,
        usageKnown: record.usage.known,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        cacheReadTokens: record.usage.cacheReadTokens,
        cacheWriteTokens: record.usage.cacheWriteTokens,
        completedAt: new Date(this.clock()),
      })
      .where(and(eq(aiAttempts.id, attemptId), eq(aiAttempts.status, "dispatched")));
  }
}

export const aiAdmissionRepository = new AIAdmissionRepository();

/** The request is still open under this admission: unit reserved, not yet settled. */
function openRequest(ref: AdmissionRef) {
  return and(
    eq(aiRequests.id, ref.requestId),
    eq(aiRequests.generation, ref.generation),
    eq(aiRequests.status, "in_progress"),
    eq(aiRequests.chatQuotaState, "reserved"),
  );
}

/** A stale worker (its request settled or re-admitted since) may not claim for it. */
async function assertOwnAdmission(tx: TransactionType, ref: AdmissionRef): Promise<void> {
  const [open] = await tx.select({ id: aiRequests.id }).from(aiRequests).where(openRequest(ref));
  if (!open) throw new ConflictError("This request was settled or retried; no further provider call is made for it.");
}

function attemptStatus(record: StageAttemptRecord): "succeeded" | "not_dispatched" | "usage_unknown" | "failed" {
  if (record.outcome === "succeeded") return "succeeded";
  if (!record.dispatched) return "not_dispatched";
  const unknown = !record.usage.known && UNKNOWN_USAGE_CATEGORIES.has(record.category ?? "");
  return unknown ? "usage_unknown" : "failed";
}

function completionValues(
  completion: { mode: AnswerMode; body: ChatResponse | null; conversationId: string | null },
  now: Date,
) {
  return {
    status: "completed" as const,
    chatQuotaState: completion.mode === "unavailable" ? ("refunded" as const) : ("consumed" as const),
    answerMode: completion.mode,
    responseBody: completion.body,
    conversationId: completion.conversationId,
    completedAt: now,
  };
}

/** The SQLSTATE of a driver error, also when drizzle wraps it as the cause. */
function postgresCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

function deadlineRefusal(provider: AIProviderId): ProviderError {
  return new ProviderError({ provider, category: "timeout", message: "The request deadline passed before the call could start.", dispatched: false });
}

function failureValues(now: Date) {
  return { status: "failed" as const, chatQuotaState: "refunded" as const, completedAt: now };
}

function capRefusal(provider: AIProviderId, category: "unconfigured" | "billing", message: string): ProviderError {
  logger.warn("AI provider call refused by cap", { provider, category });
  return new ProviderError({ provider, category, message, dispatched: false });
}

async function countProviderCalls(
  executor: Executor,
  provider: AIProviderId,
  model: string | null,
  since: Date,
): Promise<number> {
  const modelFilter = model === null ? sql`${aiAttempts.model} is null` : eq(aiAttempts.model, model);
  const [row] = await executor
    .select({ value: count() })
    .from(aiAttempts)
    .where(and(
      eq(aiAttempts.provider, provider),
      modelFilter,
      gte(aiAttempts.dispatchedAt, since),
      ne(aiAttempts.status, "not_dispatched"),
    ));
  return row?.value ?? 0;
}
