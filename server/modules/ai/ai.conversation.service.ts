/**
 * AI Conversation Service (SCP-338)
 *
 * Business logic for persisting and retrieving AI conversation history. Kept
 * separate from the chat orchestrator (`ai.service.ts`) so each file stays
 * focused and under the LOC limit.
 *
 * Every method is scoped to (household, user) via the repository (Rule 11): a
 * user must not read, delete, or write into another household's — or another
 * member's — conversations.
 *
 * @module ai/ai.conversation.service
 */

import { randomUUID } from 'crypto';
import { NotFoundError } from '../../core/errors';
import { logger } from '../../utils/logger';
import { aiConversationRepository } from './ai.conversation.repository';
import type {
  ConversationDetails,
  ConversationListResponse,
  Message
} from './ai.types';

export class AIConversationService {
  /**
   * Persist a user message + assistant reply and return the stable conversation
   * id to reuse on the next request. This is what makes history survive across
   * requests: the returned id is sent back by the client on the next chat call
   * and the exchange is appended to the same thread.
   *
   * Failure to persist must NOT fail the chat response the user already has, so
   * a store error is logged and we fall back to the supplied (or a fresh) id.
   */
  async recordExchange(params: {
    householdId: string;
    userId: string;
    conversationId?: string;
    userMessage: string;
    assistantReply: string;
    toolsUsed: string[];
  }): Promise<string> {
    const {
      householdId,
      userId,
      conversationId,
      userMessage,
      assistantReply,
      toolsUsed
    } = params;

    try {
      return await aiConversationRepository.appendExchange({
        householdId,
        userId,
        conversationId,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantReply, toolsUsed }
        ]
      });
    } catch (error) {
      logger.error('Failed to persist AI conversation', {
        error,
        householdId,
        userId
      });
      return conversationId ?? randomUUID();
    }
  }

  /**
   * List the caller's conversations (household + user scoped), most recent
   * first, with a message count and preview.
   */
  async list(params: {
    householdId: string;
    userId: string;
    limit: number;
    offset: number;
  }): Promise<ConversationListResponse> {
    const { householdId, userId, limit, offset } = params;

    const { items, total } = await aiConversationRepository.list({
      householdId,
      userId,
      limit,
      offset
    });

    return {
      conversations: items.map((item) => ({
        id: item.conversation.id,
        createdAt: item.conversation.createdAt.toISOString(),
        updatedAt: item.conversation.updatedAt.toISOString(),
        messageCount: item.messageCount,
        preview: item.preview
      })),
      total,
      hasMore: offset + items.length < total
    };
  }

  /**
   * Fetch a single conversation with its messages, scoped to the caller. Throws
   * NotFoundError when absent OR cross-tenant so existence is not leaked.
   */
  async get(params: {
    householdId: string;
    userId: string;
    conversationId: string;
  }): Promise<ConversationDetails> {
    const { householdId, userId, conversationId } = params;

    const found = await aiConversationRepository.getWithMessages({
      householdId,
      userId,
      conversationId
    });

    if (!found) {
      throw new NotFoundError('Conversation not found');
    }

    const messages: Message[] = found.messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      timestamp: message.createdAt.toISOString(),
      toolsUsed: message.toolsUsed ?? undefined
    }));

    return {
      id: found.conversation.id,
      householdId: found.conversation.householdId,
      userId: found.conversation.userId,
      messages,
      createdAt: found.conversation.createdAt.toISOString(),
      updatedAt: found.conversation.updatedAt.toISOString()
    };
  }

  /**
   * Delete a conversation (and its messages, via cascade), scoped to the
   * caller. Throws NotFoundError when nothing matched so a member cannot probe
   * another tenant's conversation ids.
   */
  async delete(params: {
    householdId: string;
    userId: string;
    conversationId: string;
  }): Promise<void> {
    const { householdId, userId, conversationId } = params;

    const deleted = await aiConversationRepository.delete({
      householdId,
      userId,
      conversationId
    });

    if (!deleted) {
      throw new NotFoundError('Conversation not found');
    }
  }
}

export const aiConversationService = new AIConversationService();
