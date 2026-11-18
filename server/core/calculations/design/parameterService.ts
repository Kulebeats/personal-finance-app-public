/**
 * Calculation Engine - Parameter Service
 *
 * Manages the retrieval and update of calculation parameters.
 * Supports versioning, effective-date lookups, and optimistic locking.
 *
 * @module core/calculations/design/parameterService
 */

import { CalculationParameters, DEFAULT_PARAMETERS } from "./parameters";
import { logger } from "../../../utils/logger";
import { getErrorMessage } from "../../errors/getErrorMessage";

export interface ParameterUpdateResult {
  success: boolean;
  newVersion?: string;
  error?: string;
}

export interface ParameterService {
  /**
   * Gets the parameters effective for a specific date.
   * @param date - ISO Date string (defaults to today)
   */
  getParameters(date?: string): Promise<CalculationParameters>;

  /**
   * Gets a specific version of parameters.
   * @param version - Version string
   */
  getVersion(version: string): Promise<CalculationParameters | null>;

  /**
   * Creates a new parameter set (draft status).
   * @param params - The parameters to create
   * @param createdBy - User ID of creator
   */
  createParameterSet(
    params: Omit<CalculationParameters, "version">,
    createdBy: string
  ): Promise<ParameterUpdateResult>;

  /**
   * Updates a parameter set with optimistic locking.
   * @param version - Version to update
   * @param params - Updated parameters
   * @param expectedRowVersion - Expected row_version for optimistic lock
   * @param updatedBy - User ID of updater
   */
  updateParameterSet(
    version: string,
    params: Partial<CalculationParameters>,
    expectedRowVersion: number,
    updatedBy: string
  ): Promise<ParameterUpdateResult>;

  /**
   * Approves a draft parameter set (four-eyes principle).
   * @param version - Version to approve
   * @param approvedBy - User ID of approver (must differ from creator)
   */
  approveParameterSet(
    version: string,
    approvedBy: string
  ): Promise<ParameterUpdateResult>;
}

/**
 * Minimal database surface used by the parameter service: a raw-SQL `execute`
 * returning rows and a row count. Declared structurally to avoid a circular
 * dependency on the concrete db module.
 */
interface ParameterDb {
  execute(
    query: string,
    params?: unknown[]
  ): Promise<{
    rows: Array<{ parameters?: Record<string, unknown>; version: string }>;
    rowCount: number;
  }>;
}

/**
 * Creates a Parameter Service.
 *
 * @param db - Database instance (optional for now, uses defaults if not provided)
 */
export function createParameterService(db?: ParameterDb): ParameterService {
  return {
    async getParameters(date?: string): Promise<CalculationParameters> {
      if (!db) {
        return DEFAULT_PARAMETERS;
      }

      try {
        // Query for approved parameters effective on or before the date
        const targetDate = date || new Date().toISOString().split("T")[0];

        const result = await db.execute(
          `
          SELECT parameters, version
          FROM calculation_parameters
          WHERE effective_date <= $1
            AND status = 'approved'
          ORDER BY effective_date DESC, created_at DESC
          LIMIT 1
        `,
          [targetDate]
        );

        if (result.rows.length === 0) {
          return DEFAULT_PARAMETERS;
        }

        const row = result.rows[0];
        return {
          ...row.parameters,
          version: row.version,
        } as CalculationParameters;
      } catch (e) {
        logger.error("Failed to load parameters", {}, e as Error);
        return DEFAULT_PARAMETERS;
      }
    },

    async getVersion(version: string): Promise<CalculationParameters | null> {
      if (version === DEFAULT_PARAMETERS.version) {
        return DEFAULT_PARAMETERS;
      }

      if (!db) {
        return null;
      }

      try {
        const result = await db.execute(
          `
          SELECT parameters, version
          FROM calculation_parameters
          WHERE version = $1
        `,
          [version]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        return {
          ...row.parameters,
          version: row.version,
        } as CalculationParameters;
      } catch (e) {
        logger.error("Failed to get parameter version", {}, e as Error);
        return null;
      }
    },

    async createParameterSet(
      params: Omit<CalculationParameters, "version">,
      createdBy: string
    ): Promise<ParameterUpdateResult> {
      if (!db) {
        return { success: false, error: "Database not available" };
      }

      try {
        // Generate new version (semver-like increment)
        const lastVersion = await db.execute(`
          SELECT version FROM calculation_parameters
          ORDER BY created_at DESC LIMIT 1
        `);

        let newVersion = "1.0.0";
        if (lastVersion.rows.length > 0) {
          const [major, minor, patch] = lastVersion.rows[0].version
            .split(".")
            .map(Number);
          newVersion = `${major}.${minor}.${patch + 1}`;
        }

        await db.execute(
          `
          INSERT INTO calculation_parameters (version, effective_date, parameters, created_by, status)
          VALUES ($1, $2, $3, $4, 'draft')
        `,
          [newVersion, params.effectiveDate, JSON.stringify(params), createdBy]
        );

        return { success: true, newVersion };
      } catch (e) {
        logger.error("Failed to create parameter set", {}, e as Error);
        return { success: false, error: getErrorMessage(e) };
      }
    },

    async updateParameterSet(
      version: string,
      params: Partial<CalculationParameters>,
      expectedRowVersion: number,
      updatedBy: string
    ): Promise<ParameterUpdateResult> {
      if (!db) {
        return { success: false, error: "Database not available" };
      }

      try {
        // Optimistic locking: only update if row_version matches
        const result = await db.execute(
          `
          UPDATE calculation_parameters
          SET parameters = parameters || $1::jsonb,
              row_version = row_version + 1
          WHERE version = $2 AND row_version = $3 AND status = 'draft'
          RETURNING version, row_version
        `,
          [JSON.stringify(params), version, expectedRowVersion]
        );

        if (result.rowCount === 0) {
          return {
            success: false,
            error:
              "Concurrent modification detected or parameter set not found/not in draft",
          };
        }

        return { success: true, newVersion: version };
      } catch (e) {
        logger.error("Failed to update parameter set", {}, e as Error);
        return { success: false, error: getErrorMessage(e) };
      }
    },

    async approveParameterSet(
      version: string,
      approvedBy: string
    ): Promise<ParameterUpdateResult> {
      if (!db) {
        return { success: false, error: "Database not available" };
      }

      try {
        // Four-eyes principle: approver must differ from creator
        const result = await db.execute(
          `
          UPDATE calculation_parameters
          SET status = 'approved',
              approved_by = $1,
              approved_at = NOW()
          WHERE version = $2
            AND status = 'draft'
            AND created_by != $1
          RETURNING version
        `,
          [approvedBy, version]
        );

        if (result.rowCount === 0) {
          return {
            success: false,
            error:
              "Cannot approve: not found, already approved, or same user as creator",
          };
        }

        return { success: true, newVersion: version };
      } catch (e) {
        logger.error("Failed to approve parameter set", {}, e as Error);
        return { success: false, error: getErrorMessage(e) };
      }
    },
  };
}
