/**
 * outboxEventService.publish — REAL DB transactional atomicity.
 *
 * The Outbox Pattern's whole purpose is that an event and the business write it
 * describes commit as ONE unit. publish() previously always inserted on its own
 * pooled connection, committing independently of the caller's transaction. That
 * left two holes:
 *
 *   - ORPHAN EVENT: the event row commits, then the caller's business
 *     transaction rolls back. An event is emitted for a row that never existed —
 *     consumers act on a phantom. This is the half the test below proves
 *     directly and deterministically (no timing needed: rollback is explicit).
 *   - LOST EVENT: the business row commits and the process dies before the
 *     fire-and-forget publish lands, so no event is ever emitted. Not
 *     reproducible in-process without killing the runtime; it is the same defect
 *     viewed from the other side, and the same fix (one transaction) closes it.
 *
 * publish(event, tx) enlists in the caller's transaction so both outcomes are
 * impossible by construction. These tests run against REAL Postgres (no db mock)
 * and assert the committed state of outbox_events.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../../db";
import { outboxEvents, households } from "@shared/schema";
import { outboxEventService } from "../outbox";
import { withTransaction } from "../../../utils/withTransaction";

describe("outboxEventService.publish — real DB transactional atomicity", () => {
  const createdHouseholdIds: string[] = [];
  const createdAggregateIds: string[] = [];

  async function seedHousehold(): Promise<string> {
    const [hh] = await db
      .insert(households)
      .values({ name: `outbox-tx-${randomUUID().slice(0, 8)}`, currency: "ZMW" })
      .returning();
    createdHouseholdIds.push(hh.id);
    return hh.id;
  }

  afterAll(async () => {
    try {
      if (createdAggregateIds.length > 0) {
        await db
          .delete(outboxEvents)
          .where(inArray(outboxEvents.aggregateId, createdAggregateIds));
      }
      for (const id of createdHouseholdIds) {
        await db.delete(households).where(eq(households.id, id));
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("outbox atomicity cleanup error", error);
    }
  });

  it("rolls the event back with the business write: a failed transaction leaves NO orphan event", async () => {
    const householdId = await seedHousehold();
    const aggregateId = randomUUID();
    createdAggregateIds.push(aggregateId);

    const boom = new Error("business write failed after publish");

    // Publish INSIDE a transaction that then fails. With the tx threaded, the
    // event insert is part of that transaction and must roll back with it.
    await expect(
      withTransaction(async (tx) => {
        await outboxEventService.publish(
          {
            eventType: "test.rollback",
            aggregateType: "transaction",
            aggregateId,
            householdId,
            payload: { id: aggregateId },
          },
          tx,
        );

        // Simulate the business write failing after the event was published.
        throw boom;
      }),
    ).rejects.toThrow(boom);

    // The decisive assertion: no event survives the rollback.
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, aggregateId));

    expect(rows).toHaveLength(0);
  });

  it("commits the event with the business write: a committed transaction persists exactly one pending event", async () => {
    const householdId = await seedHousehold();
    const aggregateId = randomUUID();
    createdAggregateIds.push(aggregateId);

    const published = await withTransaction(async (tx) => {
      const event = await outboxEventService.publish(
        {
          eventType: "test.commit",
          aggregateType: "transaction",
          aggregateId,
          householdId,
          payload: { id: aggregateId, amount: "10.00" },
        },
        tx,
      );

      // Inside the transaction the row is not yet visible to other connections;
      // reading via the pool here would see nothing. Proven by the rollback test
      // above — here we assert the post-commit state below.
      return event;
    });

    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, aggregateId));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(published.id);
    expect(rows[0].eventType).toBe("test.commit");
    expect(rows[0].status).toBe("pending");
    expect(rows[0].householdId).toBe(householdId);
  });

  it("is invisible to other connections until the transaction commits (event ships only after the business write lands)", async () => {
    const householdId = await seedHousehold();
    const aggregateId = randomUUID();
    createdAggregateIds.push(aggregateId);

    // Hold the transaction open and observe from a SEPARATE pooled connection.
    // A publish that ignored `tx` would already be visible here — this is what
    // makes the "same transaction" claim testable rather than assumed.
    let visibleDuringTx = -1;

    await withTransaction(async (tx) => {
      await outboxEventService.publish(
        {
          eventType: "test.isolation",
          aggregateType: "transaction",
          aggregateId,
          householdId,
          payload: { id: aggregateId },
        },
        tx,
      );

      const seenFromPool = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, aggregateId));
      visibleDuringTx = seenFromPool.length;
    });

    // Uncommitted: another connection must not see the event mid-transaction.
    expect(visibleDuringTx).toBe(0);

    // Committed: now it is visible and ready for the relay to ship.
    const afterCommit = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, aggregateId));
    expect(afterCommit).toHaveLength(1);
  });
});
