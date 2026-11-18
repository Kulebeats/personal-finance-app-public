/**
 * Core Jobs Module
 *
 * Background job queue with scheduling, retry, and idempotency.
 *
 * @module core/jobs
 */

// Service
export { jobService, JobTypes, type JobType, type JobHandler } from "./service";

// Runner
export { startRunner, stopRunner, isRunnerRunning, runNow } from "./runner";
