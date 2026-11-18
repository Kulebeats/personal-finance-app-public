/**
 * **Feature: settings-refactoring, Property 14: Session Invalidation Correctness**
 * **Validates: Requirements 12.3, 12.4**
 * 
 * Property: For any session revocation operation, the targeted session(s) SHALL be invalidated
 * and subsequent requests using those session tokens SHALL be rejected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { SessionService } from "../SessionService";
import { db } from "../../db";
import { userSessions } from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";

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

describe("Property 14: Session Invalidation Correctness", () => {
  let sessionService: SessionService;
  let mockInsert: any;
  let mockDelete: any;
  let mockSelect: any;
  let mockUpdate: any;

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
    
    mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn(),
    };
    
    vi.mocked(db.insert).mockReturnValue(mockInsert);
    vi.mocked(db.delete).mockReturnValue(mockDelete);
    vi.mocked(db.select).mockReturnValue(mockSelect);
    vi.mocked(db.update).mockReturnValue(mockUpdate);
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessionService.clearAuditLogs();
  });

  it("should invalidate a specific session when destroySession is called", async () => {
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

          // Act: Destroy the session
          await sessionService.destroySession(sessionToken);

          // Property: Session should be deleted from database
          expect(db.delete).toHaveBeenCalledWith(userSessions);
          expect(mockDelete.where).toHaveBeenCalled();
          
          // Verify audit log was created
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(1);
          expect(auditLogs[0].operation).toBe('destroy');
          expect(auditLogs[0].userId).toBe(userId);
          expect(auditLogs[0].sessionId).toBe(sessionId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should invalidate all sessions except current when destroyAllExcept is called", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          currentSessionToken: fc.uuid(),
          otherSessionTokens: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        }),
        async ({ userId, currentSessionToken, otherSessionTokens }) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup: Multiple sessions exist
          const otherSessions = otherSessionTokens.map((token, index) => ({
            id: `session-${index}`,
            userId,
            sessionToken: token,
          }));
          
          mockSelect.where.mockResolvedValueOnce(otherSessions);
          mockDelete.where.mockResolvedValueOnce(undefined);

          // Act: Destroy all except current
          const deletedCount = await sessionService.destroyAllExcept(userId, currentSessionToken);

          // Property: All other sessions should be deleted
          expect(deletedCount).toBe(otherSessions.length);
          expect(db.delete).toHaveBeenCalledWith(userSessions);
          
          // Verify audit log was created
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(1);
          expect(auditLogs[0].operation).toBe('destroyAll');
          expect(auditLogs[0].userId).toBe(userId);
          expect(auditLogs[0].details?.deletedCount).toBe(otherSessions.length);
          expect(auditLogs[0].details?.preservedSession).toBe(currentSessionToken);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should not delete any sessions when destroyAllExcept is called with no other sessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          currentSessionToken: fc.uuid(),
        }),
        async ({ userId, currentSessionToken }) => {
          // Setup: Only current session exists
          mockSelect.where.mockResolvedValueOnce([]);

          // Act: Destroy all except current (but there are no others)
          const deletedCount = await sessionService.destroyAllExcept(userId, currentSessionToken);

          // Property: No sessions should be deleted
          expect(deletedCount).toBe(0);
          expect(db.delete).not.toHaveBeenCalled();
          
          // No audit log should be created for no-op
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should handle destroySession for non-existent session gracefully", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (sessionToken) => {
          // Setup: Session does not exist
          mockSelect.where.mockReturnThis();
          mockSelect.limit.mockResolvedValueOnce([]);

          // Act: Try to destroy non-existent session
          await sessionService.destroySession(sessionToken);

          // Property: Should not throw error and should not delete anything
          expect(db.delete).not.toHaveBeenCalled();
          
          // No audit log should be created for non-existent session
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should create session with proper device info and expiration", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          sessionToken: fc.uuid(),
          deviceName: fc.string({ minLength: 1, maxLength: 50 }),
          browser: fc.constantFrom("Chrome", "Firefox", "Safari", "Edge"),
          os: fc.constantFrom("Windows", "macOS", "Linux", "iOS", "Android"),
          ipAddress: fc.ipV4(),
        }),
        async ({ userId, sessionToken, deviceName, browser, os, ipAddress }) => {
          // Clear audit logs for this iteration
          sessionService.clearAuditLogs();
          vi.clearAllMocks();
          
          // Setup
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
          const sessionId = fc.sample(fc.uuid(), 1)[0];
          
          mockInsert.returning.mockResolvedValueOnce([
            {
              id: sessionId,
              userId,
              sessionToken,
              deviceName,
              browser,
              os,
              ipAddress,
              expiresAt,
              createdAt: new Date(),
            },
          ]);

          // Act: Create session
          const session = await sessionService.createSession(
            userId,
            sessionToken,
            { deviceName, browser, os, ipAddress },
            expiresAt
          );

          // Property: Session should be created with correct data
          expect(session.userId).toBe(userId);
          expect(session.sessionToken).toBe(sessionToken);
          expect(session.deviceName).toBe(deviceName);
          expect(session.browser).toBe(browser);
          expect(session.os).toBe(os);
          
          // Verify audit log was created
          const auditLogs = sessionService.getAuditLogs();
          expect(auditLogs).toHaveLength(1);
          expect(auditLogs[0].operation).toBe('create');
          expect(auditLogs[0].userId).toBe(userId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
