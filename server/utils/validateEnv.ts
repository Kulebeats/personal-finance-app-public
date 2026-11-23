import { z } from "zod";
import { assertRequiredJobCapabilities, productionRedis } from "../config/redis";
import { databaseTlsIssues } from "../dbSsl";
import { publicAuthOrigin } from "../core/public-auth-link";

/**
 * Environment variable validation schema using Zod.
 * Validates required environment variables at startup and refuses to boot on missing/invalid configuration.
 *
 * **Feature: settings-refactoring**
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4**
 *
 * **SCP-324 (fail-closed):** Required operational vars must be present and well-formed
 * or the app refuses to boot - nothing required silently fails open. Feature-optional
 * vars (GEMINI_API_KEY, VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) are absent => feature
 * disabled (NOT a boot failure), but if PRESENT they must be well-formed.
 * CRON_SECRET is required in production (OPS-003) and optional in dev/test.
 * REDIS_URL is optional in dev/test. Production accepts it only when an admitted
 * profile binding is absent; that binding is separately fenced by its facades.
 */

// Minimum length for CRON_SECRET, to resist guessing.
const MIN_SECRET_LENGTH = 16;

/**
 * Optional feature var: absent (undefined or empty string) => feature disabled, accepted.
 * Present => the provided format validator must pass, otherwise boot fails closed.
 *
 * We treat empty string the same as absent because shells and PaaS dashboards commonly
 * export blank values, and the consuming code (redis.ts, cron.ts, push.ts) already
 * treats a falsy value as "not configured".
 */
function aiModelIdSchema(name: string): z.ZodType<string> {
  return z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/, `${name} must be a model id`);
}

function aiProviderSchema(name: string): z.ZodType<string> {
  return z.enum(["anthropic", "gemini", "none"], { message: `${name} must be anthropic, gemini or none` });
}

function positiveIntegerString(name: string): z.ZodType<string> {
  return z.string().regex(/^[1-9]\d*$/, `${name} must be a positive integer`);
}

function optionalFeatureVar(format: z.ZodType<string>) {
  return z.preprocess(
    (val) => (val === "" || val === undefined ? undefined : val),
    format.optional()
  );
}

// A valid Redis connection string (redis:// or rediss:// for TLS).
const redisUrlSchema = z
  .string()
  .url("REDIS_URL must be a valid URL")
  .refine(
    (url) => url.startsWith("redis://") || url.startsWith("rediss://"),
    "REDIS_URL must be a redis:// or rediss:// connection string"
  );

const booleanFlagSchema = z.enum(["true", "false"], {
  errorMap: () => ({ message: "must be either 'true' or 'false'" }),
});

// Schema for required environment variables
export const envSchema = z
  .object({
    // Database configuration - required
    DATABASE_URL: z
      .string({
        required_error: "DATABASE_URL is required. Did you forget to provision a database?",
      })
      .min(1, "DATABASE_URL cannot be empty")
      .url("DATABASE_URL must be a valid URL")
      .refine(
        (url) => url.startsWith("postgres://") || url.startsWith("postgresql://"),
        "DATABASE_URL must be a PostgreSQL connection string"
      ),

    // Session secret - required for security
    SESSION_SECRET: z
      .string({
        required_error: "SESSION_SECRET is required for secure session management",
      })
      .min(32, "SESSION_SECRET must be at least 32 characters for security"),

    // Server port - optional with default
    PORT: z
      .string()
      .optional()
      .default("5000")
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0 && val < 65536, "PORT must be a valid port number (1-65535)"),

    // Node environment - optional with default
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .optional()
      .default("development"),

    // Public client origin - used for CORS and secure cookies. Required in
    // production (see app.ts), optional in dev/test where it falls back to localhost.
    CLIENT_URL: z
      .string()
      .url("CLIENT_URL must be a valid URL")
      .optional(),
    APP_URL: z.string().optional(),

    // -------------------------------------------------------------------------
    // FEATURE-OPTIONAL vars: absent => feature disabled (boot OK). Present =>
    // must be well-formed (fail closed on malformed config, never silently).
    // -------------------------------------------------------------------------

    // Thandi providers (R17). Claude is primary, Gemini the fallback. A key
    // without its model id leaves that provider unconfigured: there is no
    // default model, and /api/ai/status reports the gap to the operator.
    // No provider configured => the labelled local mode only.
    GEMINI_API_KEY: optionalFeatureVar(
      z.string().min(1, "GEMINI_API_KEY must not be empty when set")
    ),
    GEMINI_MODEL: optionalFeatureVar(aiModelIdSchema("GEMINI_MODEL")),
    ANTHROPIC_API_KEY: optionalFeatureVar(
      z.string().min(1, "ANTHROPIC_API_KEY must not be empty when set")
    ),
    ANTHROPIC_MODEL: optionalFeatureVar(aiModelIdSchema("ANTHROPIC_MODEL")),
    AI_PRIMARY_PROVIDER: optionalFeatureVar(aiProviderSchema("AI_PRIMARY_PROVIDER")),
    AI_FALLBACK_PROVIDER: optionalFeatureVar(aiProviderSchema("AI_FALLBACK_PROVIDER")),
    AI_REQUEST_DEADLINE_MS: optionalFeatureVar(positiveIntegerString("AI_REQUEST_DEADLINE_MS")),
    AI_STAGE_TIMEOUT_MS: optionalFeatureVar(positiveIntegerString("AI_STAGE_TIMEOUT_MS")),
    AI_FALLBACK_RESERVE_MS: optionalFeatureVar(positiveIntegerString("AI_FALLBACK_RESERVE_MS")),

    // Web Push (VAPID) keys - enable push notifications. Absent => push disabled.
    // If either is set, both must be set (see superRefine below).
    VAPID_PUBLIC_KEY: optionalFeatureVar(
      z.string().min(1, "VAPID_PUBLIC_KEY must not be empty when set")
    ),
    VAPID_PRIVATE_KEY: optionalFeatureVar(
      z.string().min(1, "VAPID_PRIVATE_KEY must not be empty when set")
    ),

    // Redis connection - enables distributed cache + rate limiting. Absent is
    // allowed only in dev/test; production requires it in superRefine below.
    REDIS_URL: optionalFeatureVar(redisUrlSchema),

    // Database TLS is verified by default. A private CA must be explicitly supplied;
    // no production plaintext or certificate-verification opt-out is allowed.
    PFA_TEST_MODE: z.enum(["unit", "database"]).optional(),
    DATABASE_SSL: optionalFeatureVar(booleanFlagSchema),
    DATABASE_SSL_REJECT_UNAUTHORIZED: optionalFeatureVar(booleanFlagSchema),
    DATABASE_SSL_CA_CERT: z.string().min(1, "DATABASE_SSL_CA_CERT must not be empty when set").optional(),
    DATABASE_SSL_CA_FILE: z.string().min(1, "DATABASE_SSL_CA_FILE must not be empty when set").optional(),

    // In-process scheduler + outbox processor (server/scheduler.ts). Absent =>
    // on in production, off elsewhere; always off under NODE_ENV=test.
    SCHEDULER_ENABLED: optionalFeatureVar(booleanFlagSchema),
    // HTTP cron trigger door (/api/cron/*). Absent => mounted.
    CRON_HTTP_ENABLED: optionalFeatureVar(booleanFlagSchema),

    // Cron authentication secret - protects the HTTP cron routes and the
    // operator health view. Required in production (superRefine below). In
    // dev/test it is optional: without it those routes refuse every request
    // and startup logs one warning (core/scheduling/cronSecret.ts).
    CRON_SECRET: optionalFeatureVar(
      z
        .string()
        .min(
          MIN_SECRET_LENGTH,
          `CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters when set`
        )
    ),
  })
  .superRefine((env, ctx) => {
    try { publicAuthOrigin(env.APP_URL, env.NODE_ENV === "production"); }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: "APP_URL must be a valid public application origin (HTTPS required in production)" }); }
    if (env.NODE_ENV === "production" && !env.CLIENT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLIENT_URL"],
        message:
          "CLIENT_URL is required in production (used for CORS and secure cookies)",
      });
    }

    if (env.NODE_ENV === "production" && !env.CRON_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message:
          `CRON_SECRET is required in production (it authenticates /api/cron and the operator health view); set a random value of at least ${MIN_SECRET_LENGTH} characters`,
      });
    }

    let admittedRedisAvailable = false;
    if (env.NODE_ENV === "production" && productionRedis) {
      try {
        assertRequiredJobCapabilities();
        admittedRedisAvailable = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["REDIS_URL"],
          message: message === "REDIS_PROFILE_REQUIRED_JOB_CAPABILITY_MISSING"
            ? message
            : "The admitted production Redis profile is no longer current",
        });
      }
    }

    if (env.NODE_ENV === "production" && !env.REDIS_URL && !admittedRedisAvailable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message:
          "REDIS_URL or an admitted production Redis profile is required for distributed Redis controls",
      });
    }


    for (const issue of databaseTlsIssues(env)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.variable], message: issue.message });
    }

    // VAPID keys come as a pair: configuring one without the other is a
    // misconfiguration that would silently disable push. Fail closed.
    const hasVapidPublic = Boolean(env.VAPID_PUBLIC_KEY);
    const hasVapidPrivate = Boolean(env.VAPID_PRIVATE_KEY);
    if (hasVapidPublic !== hasVapidPrivate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasVapidPublic ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY"],
        message:
          "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together (set both to enable push, or neither to disable it)",
      });
    }
  });

// Type for validated environment
export type ValidatedEnv = z.infer<typeof envSchema>;

// Validation result type
export interface EnvValidationResult {
  success: boolean;
  data?: ValidatedEnv;
  errors?: EnvValidationError[];
}

export interface EnvValidationError {
  variable: string;
  message: string;
}

/**
 * Validates environment variables against the schema.
 * Returns a result object with success status and either validated data or errors.
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): EnvValidationResult {
  const result = envSchema.safeParse(env);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  // Transform Zod errors into user-friendly format
  const errors: EnvValidationError[] = result.error.errors.map((err) => ({
    variable: err.path.join(".") || "unknown",
    message: err.message,
  }));

  return {
    success: false,
    errors,
  };
}

/**
 * Validates environment variables and throws if invalid.
 * Use this at application startup to refuse booting on invalid configuration.
 */
export function validateEnvOrThrow(env: Record<string, string | undefined> = process.env): ValidatedEnv {
  const result = validateEnv(env);

  if (!result.success) {
    const errorMessages = result.errors!
      .map((err) => `  - ${err.variable}: ${err.message}`)
      .join("\n");

    throw new Error(
      `Environment validation failed. The application cannot start.\n\nMissing or invalid environment variables:\n${errorMessages}\n\nPlease check your .env file or environment configuration.`
    );
  }

  return result.data!;
}

/**
 * Formats validation errors for display.
 * Does not expose internal details, only variable names and user-friendly messages.
 */
export function formatEnvErrors(errors: EnvValidationError[]): string {
  return errors.map((err) => `${err.variable}: ${err.message}`).join("\n");
}
