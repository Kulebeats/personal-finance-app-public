/**
 * QA-01 / R20.3: the production-mode browser profile (playwright.production.config.ts).
 *
 * The ordinary browser server runs under NODE_ENV=test, where CSRF
 * (middleware/csrf-policy.ts) and every limiter (middleware/rateLimit.ts) skip
 * themselves, so no browser test there can show either control working. This
 * profile keeps every guard of the protected runner (manifest target, network
 * and Postgres guards, blanked provider credentials) and then switches the
 * application out of test mode before it is imported:
 *
 * - NODE_ENV=development: CSRF and the limiters are live, with the session
 *   bound csrf-csrf token, and the scheduler stays off.
 * - The built client (dist/public), not the Vite dev server.
 * - TRUST_PROXY=1, as behind the production proxy, so each spec can give its
 *   browser contexts their own client address (X-Forwarded-For) and keep its
 *   own per-IP credential budget.
 * - Plaintext loopback Postgres (DATABASE_SSL=false), allowed in development
 *   only for a loopback host.
 * - Mail through the real SMTP path to an in-process loopback sink
 *   (startProfileMailSink); provider and push egress stay blanked.
 *
 * Not production: NODE_ENV=production also requires HTTPS (APP_URL, Secure and
 * __Host- cookies, HSTS, CSP), Redis and verified database TLS
 * (utils/validateEnv.ts). This profile has none of those, so it proves the
 * live CSRF and limiter behaviour only, never TLS, cookies' Secure attributes,
 * CSP or the Redis limiter store.
 */

import { startSmtpSink, type SmtpSink } from "./smtp-sink";

export const PRODUCTION_PROFILE = "production";
/** Synthetic sender and sink login; the sink accepts any credentials and relays nothing. */
const SINK_SENDER = "no-reply@example.test";
const SINK_LOGIN = "pfa-test-sink";

/** The runtime this profile reports at /__test/profile, read by every spec. */
export interface ProductionProfileIdentity {
  profile: typeof PRODUCTION_PROFILE;
  nodeEnv: string;
  client: "built";
  trustProxy: string;
}

export function isProductionProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PFA_BROWSER_PROFILE === PRODUCTION_PROFILE;
}

/**
 * Leaves test mode. Call after the network and Postgres guards are installed
 * and the target is verified, and before any application import.
 */
export function applyProductionProfile(env: NodeJS.ProcessEnv = process.env): ProductionProfileIdentity {
  if (env.NODE_ENV !== "test" || env.PFA_TEST_MODE !== "database" || env.PFA_TEST_OUTBOUND !== "deny") {
    throw new Error("The production-mode profile starts only from the protected database test environment");
  }
  if (env.TEST_BROWSER_CLIENT !== "built") {
    throw new Error("The production-mode profile serves the built client: set TEST_BROWSER_CLIENT=built");
  }
  env.NODE_ENV = "development";
  env.DATABASE_SSL = "false";
  env.TRUST_PROXY = "1";
  env.SCHEDULER_ENABLED = "false";
  return { profile: PRODUCTION_PROFILE, nodeEnv: env.NODE_ENV, client: "built", trustProxy: env.TRUST_PROXY };
}

/**
 * AH-03: points the app's real SMTP settings at an in-process loopback sink
 * (server/testing/smtp-sink.ts), so mail takes the production send path and
 * stays in this process. Call after applyProductionProfile (test mode never
 * sends) and before the application import.
 */
export async function startProfileMailSink(env: NodeJS.ProcessEnv = process.env): Promise<SmtpSink> {
  if (env.NODE_ENV !== "development") throw new Error("The mail sink belongs to the production-mode profile");
  const sink = await startSmtpSink();
  env.SMTP_HOST = "127.0.0.1";
  env.SMTP_PORT = String(sink.port);
  env.SMTP_SECURE = "false";
  env.SMTP_USER = SINK_LOGIN;
  env.SMTP_PASS = SINK_LOGIN;
  env.SMTP_FROM = SINK_SENDER;
  return sink;
}
