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
import { aiConversationService } from './ai.conversation.service';
import {
  chatRequestSchema,
  conversationListQuerySchema,
  conversationIdSchema,
  consentRequestSchema
} from './ai.validation';
import { ValidationError, NotFoundError } from '../../core/errors';
import { logger } from '../../utils/logger';
import { businessAuditService } from '../../services/BusinessAuditService';
import { getRateLimitStatus } from './ai.middleware';
import { aiTracking } from './ai.tracking';
import { geminiClient } from './ai.gemini';
import type { AIStatusResponse } from './ai.types';

const CURRENT_CONSENT_VERSION = 'v1.0';

const aiService = new AIService();

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

    const { message, conversationId } = validation.data;
    const userId = req.user!.id;
    const householdId = req.householdContext!.householdId;
    const ipAddress = req.ip;

    // Process query
    const response = await aiService.processQuery({
      userId,
      householdId,
      message,
      conversationId,
      ipAddress
    });

    // Remaining quota comes from the limiter via the request, not by reading
    // back an outbound header — the header is a client-facing concern and its
    // name must not be load-bearing for internal values.
    response.remainingQueries = req.aiRateLimit?.remaining ?? 0;

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/status
 * Get AI service status and rate limit info
 *
 * `available` stays hardcoded true: the keyword-matching fallback in
 * ai.service.ts genuinely answers when Gemini isn't configured, so this is
 * not a provider-outage signal (product stance, v1.1 Workstream E4).
 * `degraded` is the honest, ADDITIVE signal for that case, wired to the real
 * Gemini client's own configuration check rather than reading
 * GEMINI_API_KEY here directly - the client is the single source of truth
 * for whether it initialized successfully.
 */
export async function getStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const householdId = req.householdContext!.householdId;
    const rateLimitStatus = await getRateLimitStatus(householdId);

    const response: AIStatusResponse = {
      available: true,
      degraded: !geminiClient.isAvailable(),
      rateLimit: {
        remaining: rateLimitStatus.remaining,
        resetTime: rateLimitStatus.resetTime.toISOString(),
        isLimited: rateLimitStatus.isLimited
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

    const conversation = await aiConversationService.get({
      householdId,
      userId,
      conversationId: validation.data.id
    });

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
      consentVersion: household.aiConsentVersion || CURRENT_CONSENT_VERSION,
      currentVersion: CURRENT_CONSENT_VERSION,
      needsReconsent: household.aiConsentGiven &&
        household.aiConsentVersion !== CURRENT_CONSENT_VERSION
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

    const { consentGiven } = validation.data;
    const userId = req.user!.id;
    const householdId = req.householdContext!.householdId;
    const ipAddress = req.ip;

    // Update consent status
    const now = new Date();
    await db.update(households)
      .set({
        aiConsentGiven: consentGiven,
        aiConsentDate: now,
        aiConsentVersion: consentGiven ? CURRENT_CONSENT_VERSION : null
      })
      .where(eq(households.id, householdId));

    // Audit log the consent change
    // FIX (packet R4): entityId must be a valid UUID (auditLogs.entityId is a
    // uuid column). The household is the entity whose consent changed, so use
    // householdId with the dedicated 'ai_consent' entity type. The previous
    // `consent_${householdId}` string failed Postgres uuid parsing on every
    // call, and BusinessAuditService.log() swallows non-tx write failures
    // (by design, non-blocking), so consent changes were never recorded.
    await businessAuditService.log({
      householdId,
      userId,
      action: consentGiven ? 'CREATE' : 'DELETE',
      entityType: 'ai_consent',
      entityId: householdId,
      details: {
        consent_given: consentGiven,
        consent_version: consentGiven ? CURRENT_CONSENT_VERSION : null,
        action: consentGiven ? 'AI consent granted' : 'AI consent revoked'
      },
      ipAddress
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
      consentDate: now.toISOString(),
      consentVersion: consentGiven ? CURRENT_CONSENT_VERSION : null
    });
  } catch (error) {
    next(error);
  }
}
