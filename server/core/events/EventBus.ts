/**
 * Event Bus
 *
 * In-memory event bus for domain events.
 * Supports synchronous and asynchronous handlers.
 *
 * @module core/events/EventBus
 */

import { EventEmitter } from "events";
import type { DomainEvent } from "./DomainEvent";
import { logger } from "../../utils/logger";

type EventHandler<T = unknown> = (
  event: DomainEvent<T>
) => void | Promise<void>;

class EventBusImpl {
  private emitter = new EventEmitter();
  private asyncHandlers = new Map<string, Set<EventHandler>>();

  constructor() {
    // Increase max listeners for production use
    this.emitter.setMaxListeners(100);
  }

  /**
   * Subscribe to an event type (sync handler)
   */
  on<T>(type: string, handler: EventHandler<T>): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }

  /**
   * Subscribe to an event type (async handler)
   * Async handlers are executed after sync handlers complete
   */
  onAsync<T>(type: string, handler: EventHandler<T>): () => void {
    if (!this.asyncHandlers.has(type)) {
      this.asyncHandlers.set(type, new Set());
    }
    this.asyncHandlers.get(type)!.add(handler as EventHandler);

    return () => {
      this.asyncHandlers.get(type)?.delete(handler as EventHandler);
    };
  }

  /**
   * Emit an event (sync handlers run immediately, async handlers queued)
   */
  emit<T>(event: DomainEvent<T>): void {
    logger.debug("Event emitted", {
      type: event.type,
      eventId: event.metadata.eventId,
    });

    // Run sync handlers
    this.emitter.emit(event.type, event);

    // Queue async handlers
    const asyncHandlers = this.asyncHandlers.get(event.type);
    if (asyncHandlers?.size) {
      setImmediate(async () => {
        for (const handler of Array.from(asyncHandlers)) {
          try {
            await handler(event);
          } catch (error) {
            logger.error("Async event handler failed", {
              type: event.type,
              eventId: event.metadata.eventId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
    }
  }

  /**
   * Remove all handlers (useful for testing)
   */
  reset(): void {
    this.emitter.removeAllListeners();
    this.asyncHandlers.clear();
  }
}

// Singleton instance
export const EventBus = new EventBusImpl();
