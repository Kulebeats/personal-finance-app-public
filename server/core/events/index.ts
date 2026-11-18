/**
 * Core Events Module
 *
 * In-memory domain event system for decoupled communication.
 * Includes Outbox Pattern for reliable async processing.
 *
 * @module core/events
 */

export { EventBus } from "./EventBus";
export { EventTypes as InMemoryEventTypes, type EventType } from "./eventTypes";
export {
  createEvent,
  type DomainEvent,
  type EventMetadata,
} from "./DomainEvent";

// Outbox Pattern (persistent, async processing)
export { outboxEventService, EventTypes } from "./outbox";
export {
  registerHandler,
  processEvents,
  startProcessor,
  stopProcessor,
  isProcessorRunning,
} from "./processor";
