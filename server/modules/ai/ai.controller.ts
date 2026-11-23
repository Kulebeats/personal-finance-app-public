/**
 * AI Controller
 *
 * HTTP handlers for AI assistant endpoints.
 * Delegates business logic to AIService (FIX AI-ARCH-001).
 *
 * @module ai/ai.controller
 */

import { Request, Response, NextFunction } from 'express';
import { db } from '../../db';
import { households } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { AIService } from './ai.service';
import { AIChatAdmissionService } from './ai.chat-admission.service';
import { AiQuotaExceededError, aiAdmissionRepository } from './ai.admission.repository';
import { AI_CONSENT_PROCESSORS, CURRENT_AI_CONSENT_VERSION, consentStanding } from './ai.consent-policy';
import { readServiceHealth } from './ai.health.service';
import { recordConsentDecision } from './ai.consent.service';
import { aiConversationService } from './ai.conversation.service';
import {
  chatRequestSchema,
  conversationListQuerySchema,
  conversationIdSchema,
  consentRequestSchema
} from './ai.validation';
import { ValidationError, NotFoundError } from '../../core/errors';
import { logger } from '../../utils/logger';
import { rejectForQuota, setQuotaHeaders } from './ai.middleware';
import { aiTracking } from './ai.tracking';
import { abortSignalForResponse } from './ai.request-signal';
import { providerClients } from './ai.provider-caps';
import type { AIStatusResponse } from './ai.types';

const CURRENT_CONSENT_VERSION = CURRENT_AI_CONSENT_VERSION;

const aiService = new AIService();
const chatAdmission = new AIChatAdmissionService(aiService);

/**
 * POST /api/ai/chat
 * Process user query with AI assistant
 */
export async function chat(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Validate request body
    const validation = chatRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError('Invalid request', validation.error.errors);
    }

    const { message, conversationId, clientRequestKey } = validation.data;

    // R17: admission, replay and quota come from the durable ledger. The
    // quota is read back after settlement, so headers and remainingQueries
    // agree and reflect any refund.
    const outcome = await chatAdmission.chat({
      actor: req.householdContext!,
      message,
      conversationId,
      clientRequestKey,
      consent: req.aiConsent!,
      ipAddress: req.ip,
      // P2-2: a client disconnect cancels outstanding provider work.
      signal: abortSignalForResponse(res)
    });

    setQuotaHeaders(res, outcome.quota);
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(200).json({ ...outcome.response, remainingQueries: outcome.quota.remaining });
  } catch (error) {
    if (error instanceof AiQuotaExceededError) rejectForQuota(req, res, error.quota);
    next(error);
  }
}

/**
 * GET /api/ai/status
 * Get AI service status and rate limit info
 *
 * `available` stays true: the labelled local mode answers even when no
 * provider is usable (product stance, v1.1 Workstream E4). R17: `state` and
 * `providers` report real health from the attempt ledger for the configured
 * model (configured is not healthy); `degraded` is true whenever the primary
 * is not the one serving. Quota comes from the same ledger as chat admission.
 */
export async function getStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const householdId = req.householdContext!.householdId;
    const [quota, health] = await Promise.all([
      aiAdmissionRepository.readQuota(householdId),
      readServiceHealth(providerClients)
    ]);
    const isLimited = quota.remaining === 0;

    const response: AIStatusResponse = {
      // The labelled local mode always answers, so the service is available
      // even in an outage; `state` and `providers` carry the real health.
      available: true,
      degraded: health.state !== 'operational',
      state: health.state,
      quotaLimited: isLimited,
      providers: health.providers,
      rateLimit: {
        remaining: quota.remaining,
        resetTime: quota.resetAt.toISOString(),
        isLimited
      }
    };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/conversations
 * List the caller's conversation history (household + user scoped).
 */
export async function listConversations(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Validate query params
    const validation = conversationListQuerySchema.safeParse(req.query);
    if (!validation.success) {
      throw new ValidationError('Invalid query parameters', validation.error.errors);
    }

    const { limit, offset } = validation.data;
    const userId = req.user!.id;
    const householdId = req.householdContext!.householdId;

    const result = await aiConversationService.list({
      householdId,
      userId,
      limit,
      offset
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/conversations/:id
 * Get a single conversation with its messages (household + user scoped).
 */
export async function getConversation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const validation = conversationIdSchema.safeParse(req.params);
    if (!validation.success) {
      throw new ValidationError('Invalid conversation id', validation.error.errors);
    }

    const userId = req.user!.id;
    const householdId = req.householdContext!.householdId;

    const stored = await aiConversationService.get({
      householdId,
      userId,
      conversationId: validation.data.id
    });
    // Stored replies hold labels; the viewer sees their own account names.
    const conversation = await aiService.nameStoredConversation(req.householdContext!, stored);

    res.status(200).json(conversation);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/ai/conversations/:id
 * Delete a conversation (and its messages) scoped to the caller.
 */
export async function deleteConversation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const validation = conversationIdSchema.safeParse(req.params);
    if (!validation.success) {
      throw new ValidationError('Invalid conversation id', validation.error.errors);
    }

    const userId = req.user!.id;
    const householdId = req.householdContext!.householdId;

    await aiConversationService.delete({
      householdId,
      userId,
      conversationId: validation.data.id
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/consent
 * Get current AI consent status for the household
 */
export async function getConsent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const householdId = req.householdContext!.householdId;

    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
      columns: {
        aiConsentGiven: true,
        aiConsentDate: true,
        aiConsentVersion: true
      }
    });

    if (!household) {
      throw new NotFoundError('Household not found');
    }

    res.status(200).json({
      consentGiven: household.aiConsentGiven ?? false,
      consentDate: household.aiConsentDate?.toISOString() || null,
      consentVersion: household.aiConsentGiven ? household.aiConsentVersion ?? null : null,
      currentVersion: CURRENT_CONSENT_VERSION,
      needsReconsent: consentStanding(household.aiConsentGiven, household.aiConsentVersion) === 'outdated',
      processors: [...AI_CONSENT_PROCESSORS]
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/consent
 * Grant or revoke AI consent for the household
 */
export async function setConsent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Validate request
    const validation = consentRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError('Invalid request', validation.error.errors);
    }

    const { consentGiven, consentVersion: shownVersion } = validation.data;
    const userId = req.user!.id;
    const householdId = req.householdContext!.householdId;

    // R17 (Astra #255 r3): the grant names the disclosure the actor was shown,
    // and the role is rechecked under lock in the write transaction.
    const decision = await recordConsentDecision({
      householdId,
      actorId: userId,
      consentGiven,
      shownVersion,
      ipAddress: req.ip
    });

    logger.info('AI consent updated', {
      householdId,
      userId,
      consentGiven,
      version: CURRENT_CONSENT_VERSION
    });

    // Track consent event
    if (consentGiven) {
      aiTracking.trackConsentGranted({
        householdId,
        userId,
        consentGiven: true,
        consentVersion: CURRENT_CONSENT_VERSION
      });
    } else {
      aiTracking.trackConsentRevoked({
        householdId,
        userId,
        consentGiven: false,
        consentVersion: null
      });
    }

    res.status(200).json({
      consentGiven,
      consentDate: decision.decidedAt.toISOString(),
      consentVersion: decision.consentVersion
    });
  } catch (error) {
    next(error);
  }
}
