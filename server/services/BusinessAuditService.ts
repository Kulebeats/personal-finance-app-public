/**
 * Business Audit Service
 *
 * Logs business operations to the audit_logs table.
 * Non-blocking: failures logged but don't break main flow.
 */
import { isIP } from "node:net";
import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { logger } from "../utils/logger";
import { Request } from "express";
import type { TransactionType } from "../utils/withTransaction";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "RESTORE"
  | "TRANSFER"
  | "LINK"
  | "UNLINK"
  | "PROCESS"
  | "MERGE"
  | "REVOKE_SESSION"
  | "REVOKE_ALL_SESSIONS";

export type AuditEntityType =
  | "transaction"
  | "transaction_import"
  | "balance_history_import"
  | "budget"
  | "category"
  | "category_group"
  | "recurring_rule"
  | "recurring_batch"
  | "goal"
  | "holding"
  | "investment_transaction"
  | "account"
  | "goal_transfer"
  | "goal_assignment"
  | "goal_transaction_link"
  | "receipt"
  | "security"
  | "fx_rate"
  | "rule"
  | "rule_order"
  | "merchant"
  | "tag"
  | "user"
  | "user_account"
  | "session"
  | "household_preferences"
  | "household_invitation"
  | "household_member"
  | "display_settings"
  | "notification_preference"
  | "push_subscription"
  | "filter_preset"
  | "ai_query" // AI assistant queries (FIX AI-AUDIT-001)
  | "ai_consent" // AI consent grant/revoke (packet R4, Zambia DPA)
  | "grz_bond" // GRZ sovereign bonds (SCP-312)
  | "grz_tbill" // GRZ treasury bills (SCP-312)
  | "grz_bond_payment" // GRZ bond coupon payments (SCP-312)
  | "grz_auction_result" // GRZ auction results (SCP-312)
  | "data_export"; // Financial/PII data export egress (SCP-336)

export interface AuditLogEntry {
  householdId?: string | null;
  /** Real actor id, or null for system/cron-initiated writes. */
  userId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  details?: Record<string, unknown>; // Before/after state, error details
  ipAddress?: string;
  /**
   * When provided, the audit row is written through this transaction so it is
   * atomic with the business write. In that case a failure PROPAGATES (rolling
   * back the financial write) rather than being swallowed.
   */
  tx?: TransactionType;
}

class BusinessAuditService {
  async log(entry: AuditLogEntry): Promise<void> {
    const values = {
      householdId: entry.householdId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details || {},
      ipAddress: entry.ipAddress || null,
    };

    // In-transaction: the audit row must be atomic with the business write, so
    // write through the provided tx and let any error PROPAGATE (rolling back the
    // financial write — a regulated write must never commit unlogged).
    if (entry.tx) {
      await entry.tx.insert(auditLogs).values(values);
      return;
    }

    // Otherwise non-blocking: log the error but don't break the main flow.
    try {
      await db.insert(auditLogs).values(values);
    } catch (error) {
      logger.error("Failed to write audit log", {
        error,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
      });
    }
  }

  /**
   * Helper for logging creation events
   */
  async logCreate(params: {
    userId: string | null;
    householdId?: string | null;
    entityId: string;
    entityType: AuditEntityType;
    newValue: unknown;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
    tx?: TransactionType;
  }) {
    return this.log({
      userId: params.userId,
      householdId: params.householdId,
      action: "CREATE",
      entityId: params.entityId,
      entityType: params.entityType,
      ipAddress: params.ipAddress,
      tx: params.tx,
      details: {
        newValue: params.newValue,
        ...params.metadata,
      },
    });
  }

  /**
   * Helper for logging update events
   */
  async logUpdate(params: {
    userId: string | null;
    householdId?: string | null;
    entityId: string;
    entityType: AuditEntityType;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
    tx?: TransactionType;
  }) {
    return this.log({
      userId: params.userId,
      householdId: params.householdId,
      action: "UPDATE",
      entityId: params.entityId,
      entityType: params.entityType,
      ipAddress: params.ipAddress,
      tx: params.tx,
      details: {
        oldValue: params.oldValue,
        newValue: params.newValue,
        changes: params.oldValue && params.newValue ? this.calculateChanges(params.oldValue, params.newValue) : null,
        ...params.metadata,
      },
    });
  }

  /**
   * Helper for logging deletion events
   */
  async logDelete(params: {
    userId: string | null;
    householdId?: string | null;
    entityId: string;
    entityType: AuditEntityType;
    oldValue?: unknown;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
    tx?: TransactionType;
  }) {
    return this.log({
      userId: params.userId,
      householdId: params.householdId,
      action: "DELETE",
      entityId: params.entityId,
      entityType: params.entityType,
      ipAddress: params.ipAddress,
      tx: params.tx,
      details: {
        oldValue: params.oldValue,
        ...params.metadata,
      },
    });
  }

  /**
   * Helper to simple diff objects
   */
  private calculateChanges(oldVal: Record<string, unknown>, newVal: Record<string, unknown>) {
    if (!oldVal || !newVal) return null;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);

    for (const key of keys) {
      if (JSON.stringify(oldVal[key]) !== JSON.stringify(newVal[key])) {
        changes[key] = { from: oldVal[key], to: newVal[key] };
      }
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }

  /**
   * Helper to extract the client IP from an Express request.
   *
   * Uses the address Express resolves from the `trust proxy` setting, never the
   * raw `x-forwarded-for` header. Behind more than one proxy that header is a
   * comma-separated chain, which the `inet` audit column rejects, and a client
   * can set it to any value when no proxy is trusted.
   */
  getIpAddress(req: Request): string | undefined {
    const candidates = [req.ip, req.socket.remoteAddress];
    for (const candidate of candidates) {
      // An IPv6 zone index ("fe80::1%eth0") is not valid for the inet column.
      const address = candidate?.split("%")[0];
      if (address && isIP(address) !== 0) {
        return address;
      }
    }
    return undefined;
  }
}

export const businessAuditService = new BusinessAuditService();
