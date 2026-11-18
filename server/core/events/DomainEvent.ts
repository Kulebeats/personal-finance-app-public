/**
 * Domain Event Interface
 *
 * Standard interface for all domain events in the system.
 *
 * @module core/events/DomainEvent
 */

export interface DomainEvent<T = unknown> {
  readonly type: string;
  readonly payload: T;
  readonly metadata: EventMetadata;
}

export interface EventMetadata {
  eventId: string;
  timestamp: string;
  correlationId?: string;
  causationId?: string;
  userId?: number;
  householdId?: number;
}

/**
 * Create a new domain event with auto-generated metadata.
 */
export function createEvent<T>(
  type: string,
  payload: T,
  metadata?: Partial<EventMetadata>
): DomainEvent<T> {
  return {
    type,
    payload,
    metadata: {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...metadata,
    },
  };
}
