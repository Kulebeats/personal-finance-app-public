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
import { checkPersonalExportStorageAtBoot } from "./modules/settings/settings.privacy-export.storage";
import { checkObjectStoreAtBoot } from "./core/storage/runtime";
import { drainStoragePurgeItemsAtBoot } from "./modules/settings/settings.account-deletion.purge";

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

    // Personal-data exports: log a clear error now if their directory is
    // unusable (requests then get 503). Never throws, so it cannot block boot.
    void checkPersonalExportStorageAtBoot();

    // Uploads (OPS-001): log a clear error now if the ObjectStore is misconfigured
    // or unwritable (uploads then answer 503). Never throws.
    void checkObjectStoreAtBoot();

    // A-34: delete stored files an erasure recorded but a stopped process did
    // not get to (FOR UPDATE SKIP LOCKED, so instances never double-process).
    // Never throws. A periodic drain is a follow-up.
    void drainStoragePurgeItemsAtBoot();

    logger.info("Core services initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize core services", {}, error as Error);
    throw error;
  }
}
