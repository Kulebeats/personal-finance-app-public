import { describe, it, expect, vi, beforeEach } from "vitest";
import { authSecurityReportService } from "../auth.security.report";
import { auditService, AuditEventType } from "../../../services/AuditService";
import { notificationService } from "../../../services/NotificationService";
import { NOTIFICATION_TYPES } from "../../../../shared/notificationTypes";

// Mock dependencies
vi.mock("../../../services/AuditService", () => ({
  auditService: {
    getEvents: vi.fn(),
  },
  AuditEventType: {
    LOGIN_FAILED: "LOGIN_FAILED",
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    PASSWORD_CHANGE: "PASSWORD_CHANGE",
  },
}));

vi.mock("../../../services/NotificationService", () => ({
  notificationService: {
    notify: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  db: {},
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Auth Security Reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateReportData", () => {
    it("should aggregate stats correctly", async () => {
      const mockEvents = [
        {
          eventType: AuditEventType.LOGIN_FAILED,
          userId: "123e4567-e89b-12d3-a456-426614174000",
        },
        {
          eventType: AuditEventType.LOGIN_FAILED,
          userId: "123e4567-e89b-12d3-a456-426614174000",
        },
        {
          eventType: AuditEventType.LOGIN_SUCCESS,
          userId: "123e4567-e89b-12d3-a456-426614174000",
        },
        {
          eventType: AuditEventType.LOGIN_SUCCESS,
          userId: "123e4567-e89b-12d3-a456-426614174000",
          details: { isNewDevice: true },
        },
      ];

      (auditService.getEvents as any).mockResolvedValue(mockEvents);

      const data = await authSecurityReportService.generateReportData(
        "123e4567-e89b-12d3-a456-426614174000",
      );

      expect(data.stats.failedLogins).toBe(2);
      expect(data.stats.successfulLogins).toBe(2);
      expect(data.stats.newDevices).toBe(1);
      expect(data.hasActivity).toBe(true);
    });

    it("should mark no activity if no events match criteria", async () => {
      (auditService.getEvents as any).mockResolvedValue([
        {
          eventType: AuditEventType.LOGIN_SUCCESS,
          userId: "123e4567-e89b-12d3-a456-426614174000",
        }, // Only boring success
      ]);

      const data = await authSecurityReportService.generateReportData(
        "123e4567-e89b-12d3-a456-426614174000",
      );
      expect(data.hasActivity).toBe(false);
    });
  });

  describe("sendDailySecurityReport", () => {
    it("should send notification if significant activity exists", async () => {
      const mockEvents = [
        {
          eventType: AuditEventType.LOGIN_FAILED,
          userId: "123e4567-e89b-12d3-a456-426614174000",
        },
      ];
      (auditService.getEvents as any).mockResolvedValue(mockEvents);

      await authSecurityReportService.sendDailySecurityReport(
        "123e4567-e89b-12d3-a456-426614174000",
      );

      expect(notificationService.notify).toHaveBeenCalledWith(
        "123e4567-e89b-12d3-a456-426614174000",
        null,
        NOTIFICATION_TYPES.NEW_LOGIN,
        expect.objectContaining({
          title: "Daily Security Report",
          metadata: expect.objectContaining({
            reportType: "daily_security_digest",
          }),
        }),
      );
    });

    it("should NOT send notification if no significant activity", async () => {
      (auditService.getEvents as any).mockResolvedValue([]);

      await authSecurityReportService.sendDailySecurityReport(
        "123e4567-e89b-12d3-a456-426614174000",
      );

      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });
});
