/**
 * **Feature: settings-refactoring, Property 15: Session Audit Logging**
 * **Validates: Requirements 12.5**
 * 
 * Property: For any session operation (create, destroy, destroyAll), the system SHALL produce
 * an audit log entry containing the operation type, user ID, and timestamp.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { SessionService } from "../SessionService";
import { db } from "../../db";

// Configure fast-check to run minimum 100 iterations
fc.configureGlobal({ numRuns: 100 });

// Mock database
vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

describe("Property 15: Session Audit Logging", () => {
  let sessionService: SessionService;
  let mockInsert: any;
  let mockDelete: any;
  let mockSelect: any;

  beforeEach(() => {
    sessionService = new SessionService();
    sessionService.clearAuditLogs();
    
    // Setup mock chain
    mockInsert = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    };
    
    mockDelete = {
      where: vi.fn(),
    };
    
    mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn(),
    };
    
    vi.mocked(db.insert).mockReturnValue(mockInsert);
    vi.mocked(db.delete).mockReturnValue(mockDelete);
    vi.mocked(db.select).mockReturnValue(mockSelect);
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessionService.clearAuditLogs();
  });

  it("should log audit entry for every session creation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          sessionToken: fc.uuid(),
          deviceName: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        async ({ userId, sessionToken, deviceName }) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          const sessionId = fc.sample(fc.uuid(), 1)[0];
          
          mockInsert.returning.mockResolvedValueOnce([
            {
              id: sessionId,
              userId,
              sessionToken,
              deviceName,
              expiresAt,
              createdAt: new Date(),
            },
          ]);

          // Act: Create session
          await sessionService.createSession(
            userId,
            sessionToken,
            { deviceName },
            expiresAt
          );

          // Property: Audit log should contain operation, userId, and timestamp
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(1);
          expect(auditLogs[0]).toMatchObject({
            operation: 'create',
            userId: userId,
            sessionId: sessionId,
          });
          expect(auditLogs[0].timestamp).toBeInstanceOf(Date);
          expect(auditLogs[0].details).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should log audit entry for every session destruction", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          sessionToken: fc.uuid(),
          sessionId: fc.uuid(),
        }),
        async ({ userId, sessionToken, sessionId }) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup: Session exists
          mockSelect.where.mockReturnThis();
          mockSelect.limit.mockResolvedValueOnce([
            {
              id: sessionId,
              userId,
              sessionToken,
            },
          ]);
          
          mockDelete.where.mockResolvedValueOnce(undefined);

          // Act: Destroy session
          await sessionService.destroySession(sessionToken);

          // Property: Audit log should contain operation, userId, and timestamp
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(1);
          expect(auditLogs[0]).toMatchObject({
            operation: 'destroy',
            userId: userId,
            sessionId: sessionId,
          });
          expect(auditLogs[0].timestamp).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should log audit entry for destroyAll operations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          currentSessionToken: fc.uuid(),
          otherSessionCount: fc.integer({ min: 1, max: 10 }),
        }),
        async ({ userId, currentSessionToken, otherSessionCount }) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup: Multiple sessions exist
          const otherSessions = Array.from({ length: otherSessionCount }, (_, i) => ({
            id: `session-${i}`,
            userId,
            sessionToken: `token-${i}`,
          }));
          
          mockSelect.where.mockResolvedValueOnce(otherSessions);
          mockDelete.where.mockResolvedValueOnce(undefined);

          // Act: Destroy all except current
          await sessionService.destroyAllExcept(userId, currentSessionToken);

          // Property: Audit log should contain operation, userId, timestamp, and details
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(1);
          expect(auditLogs[0]).toMatchObject({
            operation: 'destroyAll',
            userId: userId,
          });
          expect(auditLogs[0].timestamp).toBeInstanceOf(Date);
          expect(auditLogs[0].details).toBeDefined();
          expect(auditLogs[0].details?.deletedCount).toBe(otherSessionCount);
          expect(auditLogs[0].details?.preservedSession).toBe(currentSessionToken);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should not log audit entry when no sessions are destroyed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          currentSessionToken: fc.uuid(),
        }),
        async ({ userId, currentSessionToken }) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup: No other sessions exist
          mockSelect.where.mockResolvedValueOnce([]);

          // Act: Try to destroy all except current (but there are no others)
          await sessionService.destroyAllExcept(userId, currentSessionToken);

          // Property: No audit log should be created for no-op
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should not log audit entry for non-existent session destruction", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (sessionToken) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup: Session does not exist
          mockSelect.where.mockReturnThis();
          mockSelect.limit.mockResolvedValueOnce([]);

          // Act: Try to destroy non-existent session
          await sessionService.destroySession(sessionToken);

          // Property: No audit log should be created for non-existent session
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should maintain chronological order of audit logs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            sessionToken: fc.uuid(),
          }),
          { minLength: 2, maxLength: 3 }
        ),
        async (operations) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup and perform multiple operations
          for (const op of operations) {
            const sessionId = fc.sample(fc.uuid(), 1)[0];
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            
            mockInsert.returning.mockResolvedValueOnce([
              {
                id: sessionId,
                userId: op.userId,
                sessionToken: op.sessionToken,
                expiresAt,
                createdAt: new Date(),
              },
            ]);

            await sessionService.createSession(
              op.userId,
              op.sessionToken,
              {},
              expiresAt
            );
          }

          // Property: Audit logs should be in chronological order
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(operations.length);
          
          for (let i = 1; i < auditLogs.length; i++) {
            expect(auditLogs[i].timestamp.getTime()).toBeGreaterThanOrEqual(
              auditLogs[i - 1].timestamp.getTime()
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
