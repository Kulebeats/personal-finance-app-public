/**
 * AI Module Routes
 *
 * Defines HTTP routes for AI assistant endpoints.
 * Applies rate limiting and consent check middleware.
 *
 * @module ai/ai.routes
 */

import { Router } from 'express';
import * as aiController from './ai.controller';
import { rateLimitMiddleware, consentCheckMiddleware } from './ai.middleware';
import { requireAuth, householdGuard, requireRole } from '../../middleware/auth';

const router = Router();

// All AI routes require authentication and household membership
// FIX SEC-AI-001: Added householdGuard to prevent 500 errors and enforce tenant isolation
router.use(requireAuth, householdGuard);

// Apply consent check and rate limiting to AI query endpoints
const aiMiddleware = [consentCheckMiddleware, rateLimitMiddleware];

/**
 * POST /api/ai/chat
 * Process user query with AI assistant
 *
 * Middleware:
 * - requireAuth: User must be authenticated
 * - consentCheckMiddleware: Household must have given AI consent
 * - rateLimitMiddleware: 50 queries/household/day (FIX AI-RATE-001)
 *
 * Body:
 * - message: string (1-1000 chars)
 * - conversationId?: string (optional)
 */
router.post('/chat', aiMiddleware, aiController.chat);

/**
 * GET /api/ai/status
 * Get AI service status and rate limit info
 *
 * No rate limit on status endpoint
 */
router.get('/status', aiController.getStatus);

/**
 * GET /api/ai/consent
 * Get AI consent status for the household
 *
 * No rate limit on consent endpoint
 */
router.get('/consent', aiController.getConsent);

/**
 * POST /api/ai/consent
 * Grant or revoke AI consent for the household
 *
 * SEC-RBAC-001: Requires admin role - consent affects entire household
 *
 * Body:
 * - consentGiven: boolean
 */
router.post('/consent', requireRole('admin'), aiController.setConsent);

/**
 * GET /api/ai/conversations
 * List conversation history
 *
 * Query params:
 * - limit: number (1-50, default 10)
 * - offset: number (default 0)
 */
router.get('/conversations', aiController.listConversations);

/**
 * GET /api/ai/conversations/:id
 * Get conversation details
 */
router.get('/conversations/:id', aiController.getConversation);

/**
 * DELETE /api/ai/conversations/:id
 * Delete conversation
 *
 * SEC-RBAC-002: Requires member role to delete conversations
 */
router.delete('/conversations/:id', requireRole('member'), aiController.deleteConversation);

export default router;
