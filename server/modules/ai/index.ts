/**
 * AI Module Entry Point
 *
 * Exports AI module routes and services.
 *
 * @module ai
 */

export { default as aiRoutes } from './ai.routes';
export { AIService } from './ai.service';
export { AIConversationService, aiConversationService } from './ai.conversation.service';
export {
  AIConversationRepository,
  aiConversationRepository
} from './ai.conversation.repository';
export { AIAnalyticsService } from './ai.analytics.service';
export { geminiClient, GeminiClient } from './ai.gemini';
export {
  aiCache,
  AICache,
  invalidateOnTransactionChange,
  invalidateOnGoalChange,
  invalidateOnBudgetChange,
  invalidateOnRecurringChange,
  invalidateOnAccountChange
} from './ai.cache';
export { aiTracking } from './ai.tracking';
export { runAIEvalPack } from './ai.eval-pack';
export * from './ai.types';
export * from './ai.validation';
export * from './ai.privacy-filters';
export * from './ai.guardrails';
