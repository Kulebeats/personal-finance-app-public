/**
 * Job Runner
 *
 * Background processor that polls for and executes pending jobs.
 *
 * @module core/jobs/runner
 */

import { jobService } from "./service";
import { logger } from "../../utils/logger";

/**
 * Runner configuration
 */
interface RunnerConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  concurrency: number;
}

let runnerInterval: NodeJS.Timeout | null = null;
let runnerConfig: RunnerConfig = {
  enabled: false,
  intervalMs: 30000, // 30 seconds
  batchSize: 5,
  concurrency: 1,
};

let isProcessing = false;

/**
 * Process pending jobs
 */
async function processJobs(): Promise<number> {
  if (isProcessing) {
    return 0;
  }

  isProcessing = true;
  let processed = 0;

  try {
    const pendingJobs = await jobService.getPendingJobs(runnerConfig.batchSize);

    if (pendingJobs.length === 0) {
      return 0;
    }

    for (const job of pendingJobs) {
      try {
        await jobService.run(job);
        processed++;
      } catch (error) {
        logger.error("Job runner error", { jobId: job.id, error });
      }
    }

    logger.debug("Jobs processed", { count: processed });
  } finally {
    isProcessing = false;
  }

  return processed;
}

/**
 * Start the job runner
 */
export function startRunner(config?: Partial<RunnerConfig>): void {
  if (runnerInterval) {
    logger.warn("Job runner already running");
    return;
  }

  runnerConfig = { ...runnerConfig, ...config, enabled: true };

  runnerInterval = setInterval(async () => {
    try {
      await processJobs();
    } catch (error) {
      logger.error("Job runner error", { error });
    }
  }, runnerConfig.intervalMs);

  logger.info("Job runner started", {
    intervalMs: runnerConfig.intervalMs,
    batchSize: runnerConfig.batchSize,
  });
}

/**
 * Stop the job runner
 */
export function stopRunner(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    runnerConfig.enabled = false;
    logger.info("Job runner stopped");
  }
}

/**
 * Check if runner is running
 */
export function isRunnerRunning(): boolean {
  return runnerConfig.enabled && runnerInterval !== null;
}

/**
 * Run pending jobs immediately (for testing or manual trigger)
 */
export async function runNow(): Promise<number> {
  return processJobs();
}
