/**
 * Application Startup Initialization
 *
 * Initializes core services at application startup.
 *
 * @module server/startup
 */

import { db } from "./db";
import { fxRates } from "@shared/schema";
import {
  createFXRateRepository,
  createFXRateService,
  setGlobalFXService,
} from "./core/calculations";
import { logger } from "./utils/logger";
import { initScheduler } from "./scheduler";
import { registerProcessErrorHandlers } from "./utils/processHandlers";

/**
 * Initialize all core services.
 * This should be called before the server starts listening.
 */
export function initializeServices(): void {
  try {
    // SCP-325: catch fire-and-forget async rejections + uncaught exceptions
    // (registered first so it covers the rest of startup).
    registerProcessErrorHandlers();

    // Initialize FX Rate Service
    const fxRepo = createFXRateRepository(db, fxRates);
    const fxService = createFXRateService(fxRepo, {
      cacheTtlSeconds: 5 * 60, // 5 minutes
      baseCurrency: "USD",
      fallbackDays: 30,
    });
    setGlobalFXService(fxService);

    // Initialize Scheduled Jobs
    initScheduler();

    logger.info("Core services initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize core services", {}, error as Error);
    throw error;
  }
}
