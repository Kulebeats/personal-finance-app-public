/**
 * Event Processor Job
 *
 * Background job that polls the outbox for pending events
 * and dispatches them to registered handlers.
 *
 * @module core/events/processor
 */

import { outboxEventService, EventTypes } from "./outbox";
import { EventBus } from "./EventBus";
import { createEvent } from "./DomainEvent";
import { logger } from "../../utils/logger";
import type { OutboxEvent } from "../../../shared/schema";

/**
 * Event handler type
 */
type EventHandler = (event: OutboxEvent) => Promise<void>;

/**
 * Handler registry
 */
const handlers = new Map<string, EventHandler[]>();

/**
 * Register an event handler
 */
export function registerHandler(
  eventType: string,
  handler: EventHandler
): void {
  const existing = handlers.get(eventType) || [];
  existing.push(handler);
  handlers.set(eventType, existing);
  logger.debug("Event handler registered", { eventType });
}

/**
 * Process a single event
 */
async function processEvent(event: OutboxEvent): Promise<void> {
  const eventHandlers = handlers.get(event.eventType) || [];

  if (eventHandlers.length === 0) {
    // No handlers registered - still mark complete but log
    logger.debug("No handlers for event type", { eventType: event.eventType });
    await outboxEventService.markCompleted(event.id);
    return;
  }

  // Execute all handlers
  for (const handler of eventHandlers) {
    await handler(event);
  }

  // Also emit to EventBus for in-process listeners
  EventBus.emit(
    createEvent(event.eventType, event.payload as Record<string, unknown>)
  );

  await outboxEventService.markCompleted(event.id);
}

/**
 * Process pending events from the outbox
 */
export async function processEvents(batchSize = 10): Promise<number> {
  const events = await outboxEventService.getPendingEvents(batchSize);

  if (events.length === 0) {
    return 0;
  }

  let processed = 0;

  for (const event of events) {
    try {
      // Atomically claim the event - skip if already claimed by another worker
      const claimed = await outboxEventService.markProcessing(event.id);
      if (!claimed) {
        logger.debug("Event already claimed by another worker", {
          eventId: event.id,
        });
        continue;
      }
      await processEvent(event);
      processed++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await outboxEventService.markFailed(event.id, errorMessage);
      logger.error("Event processing failed", {
        eventId: event.id,
        eventType: event.eventType,
        error: errorMessage,
      });
    }
  }

  logger.debug("Events processed", {
    batch: events.length,
    successful: processed,
  });

  return processed;
}

/**
 * Event processor configuration
 */
interface ProcessorConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
}

let processorInterval: NodeJS.Timeout | null = null;
let processorConfig: ProcessorConfig = {
  enabled: false,
  intervalMs: 5000, // 5 seconds
  batchSize: 10,
};

/**
 * Start the event processor
 */
export function startProcessor(config?: Partial<ProcessorConfig>): void {
  if (processorInterval) {
    logger.warn("Event processor already running");
    return;
  }

  processorConfig = { ...processorConfig, ...config, enabled: true };

  processorInterval = setInterval(async () => {
    try {
      await processEvents(processorConfig.batchSize);
    } catch (error) {
      logger.error("Event processor error", { error });
    }
  }, processorConfig.intervalMs);

  logger.info("Event processor started", {
    intervalMs: processorConfig.intervalMs,
    batchSize: processorConfig.batchSize,
  });
}

/**
 * Stop the event processor
 */
export function stopProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    processorConfig.enabled = false;
    logger.info("Event processor stopped");
  }
}

/**
 * Check if processor is running
 */
export function isProcessorRunning(): boolean {
  return processorConfig.enabled && processorInterval !== null;
}

// Re-export for convenience
export { EventTypes };
