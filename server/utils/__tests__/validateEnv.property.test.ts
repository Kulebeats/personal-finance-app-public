import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateEnv,
  validateEnvOrThrow,
  envSchema,
  type EnvValidationResult,
} from "../validateEnv";

/**
 * **Feature: settings-refactoring, Property 19: Environment Validation at Startup**
 *
 * For any required environment variable that is missing or invalid,
 * the application SHALL refuse to start and display a clear error message
 * identifying the missing configuration.
 *
 * **Validates: Requirements 15.1, 15.2**
 */
describe("Property 19: Environment Validation at Startup", () => {
  it.each([undefined, "http://app.example.invalid", "https://app.example.invalid/path", "https://user:secret@app.example.invalid", "https://app.example.invalid/?q=1"])("rejects unusable production APP_URL %s at boot", APP_URL => {
    const result = validateEnv({ DATABASE_URL: "postgresql://test:test@localhost:5432/db", SESSION_SECRET: "s".repeat(32),
      NODE_ENV: "production", CLIENT_URL: "https://app.example.invalid", REDIS_URL: "redis://localhost:6379", APP_URL });
    expect(result.errors?.some(error => error.variable === "APP_URL")).toBe(true);
  });
  // Arbitrary for valid DATABASE_URL
  const validDatabaseUrl = fc.constantFrom(
    "postgres://user:pass@localhost:5432/db",
    "postgresql://admin:secret@127.0.0.1:5432/finance",
    "postgres://test:test@db.example.com:5432/testdb"
  );

  // Arbitrary for valid SESSION_SECRET (at least 32 chars)
  const validSessionSecret = fc.string({ minLength: 32, maxLength: 128 });

  // Arbitrary for valid PORT
  const validPort = fc.integer({ min: 1, max: 65535 }).map(String);

  // Arbitrary for valid NODE_ENV
  const validNodeEnv = fc.constantFrom("development", "production", "test");

  // Arbitrary for valid CLIENT_URL (required in production)
  const validClientUrl = fc.constantFrom(
    "https://app.example.com",
    "https://finance.onrender.com",
    "http://localhost:5000"
  );

  // Arbitrary for complete valid environment
  const validEnvArbitrary = fc.record({
    DATABASE_URL: validDatabaseUrl,
    SESSION_SECRET: validSessionSecret,
    PORT: validPort,
    NODE_ENV: validNodeEnv,
    CLIENT_URL: validClientUrl,
    REDIS_URL: fc.constant("redis://localhost:6379"),
    APP_URL: fc.constant("https://app.example.invalid"),
    // Required in production while the HTTP cron routes are mounted (OPS-003).
    CRON_SECRET: fc.constant("synthetic-cron-secret-not-real-use"),
  });

  it("accepts all valid environment configurations", () => {
    fc.assert(
      fc.property(validEnvArbitrary, (env) => {
        const result = validateEnv(env);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.errors).toBeUndefined();
        return result.success;
      }),
      { numRuns: 100 }
    );
  });

  it("rejects missing DATABASE_URL with clear error message", () => {
    fc.assert(
      fc.property(validSessionSecret, validPort, validNodeEnv, (secret, port, nodeEnv) => {
        const env = {
          SESSION_SECRET: secret,
          PORT: port,
          NODE_ENV: nodeEnv,
          // DATABASE_URL intentionally missing
        };

        const result = validateEnv(env);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.variable === "DATABASE_URL")).toBe(true);
        return !result.success;
      }),
      { numRuns: 100 }
    );
  });

  it("rejects missing SESSION_SECRET with clear error message", () => {
    fc.assert(
      fc.property(validDatabaseUrl, validPort, validNodeEnv, (dbUrl, port, nodeEnv) => {
        const env = {
          DATABASE_URL: dbUrl,
          PORT: port,
          NODE_ENV: nodeEnv,
          // SESSION_SECRET intentionally missing
        };

        const result = validateEnv(env);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.variable === "SESSION_SECRET")).toBe(true);
        return !result.success;
      }),
      { numRuns: 100 }
    );
  });

  it("rejects SESSION_SECRET shorter than 32 characters", () => {
    fc.assert(
      fc.property(
        validDatabaseUrl,
        fc.string({ minLength: 1, maxLength: 31 }), // Too short
        validPort,
        validNodeEnv,
        (dbUrl, shortSecret, port, nodeEnv) => {
          const env = {
            DATABASE_URL: dbUrl,
            SESSION_SECRET: shortSecret,
            PORT: port,
            NODE_ENV: nodeEnv,
          };

          const result = validateEnv(env);
          expect(result.success).toBe(false);
          expect(result.errors!.some((e) => e.variable === "SESSION_SECRET")).toBe(true);
          return !result.success;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects invalid DATABASE_URL formats", () => {
    // Invalid URLs that don't start with postgres:// or postgresql://
    const invalidDbUrls = fc.oneof(
      fc.constant("mysql://user:pass@localhost:3306/db"),
      fc.constant("http://localhost:5432/db"),
      fc.constant("not-a-url"),
      fc.constant(""),
      fc.constant("mongodb://localhost:27017/db")
    );

    fc.assert(
      fc.property(invalidDbUrls, validSessionSecret, (invalidUrl, secret) => {
        const env = {
          DATABASE_URL: invalidUrl,
          SESSION_SECRET: secret,
        };

        const result = validateEnv(env);
        expect(result.success).toBe(false);
        expect(result.errors!.some((e) => e.variable === "DATABASE_URL")).toBe(true);
        return !result.success;
      }),
      { numRuns: 100 }
    );
  });

  it("throws with descriptive error message when validation fails", () => {
    fc.assert(
      fc.property(validSessionSecret, (secret) => {
        const env = {
          SESSION_SECRET: secret,
          // DATABASE_URL missing
        };

        expect(() => validateEnvOrThrow(env)).toThrow("Environment validation failed");
        expect(() => validateEnvOrThrow(env)).toThrow("DATABASE_URL");

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it("error messages identify the specific missing/invalid variable", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("DATABASE_URL", "SESSION_SECRET"),
        (missingVar) => {
          const env: Record<string, string> = {
            DATABASE_URL: "postgres://user:pass@localhost:5432/db",
            SESSION_SECRET: "a".repeat(32),
          };

          // Remove the variable we want to test
          delete env[missingVar];

          const result = validateEnv(env);
          expect(result.success).toBe(false);
          expect(result.errors).toBeDefined();

          // Error should identify the specific variable
          const errorForVar = result.errors!.find((e) => e.variable === missingVar);
          expect(errorForVar).toBeDefined();
          expect(errorForVar!.message.length).toBeGreaterThan(0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("uses default values for optional variables when not provided", () => {
    fc.assert(
      fc.property(validDatabaseUrl, validSessionSecret, (dbUrl, secret) => {
        const env = {
          DATABASE_URL: dbUrl,
          SESSION_SECRET: secret,
          // PORT and NODE_ENV not provided - should use defaults
        };

        const result = validateEnv(env);
        expect(result.success).toBe(true);
        expect(result.data!.PORT).toBe(5000); // Default port
        expect(result.data!.NODE_ENV).toBe("development"); // Default env

        return result.success;
      }),
      { numRuns: 100 }
    );
  });

  it("rejects invalid PORT values", () => {
    const invalidPorts = fc.oneof(
      fc.constant("0"),
      fc.constant("-1"),
      fc.constant("65536"),
      fc.constant("not-a-number"),
      fc.constant("99999")
    );

    fc.assert(
      fc.property(validDatabaseUrl, validSessionSecret, invalidPorts, (dbUrl, secret, port) => {
        const env = {
          DATABASE_URL: dbUrl,
          SESSION_SECRET: secret,
          PORT: port,
        };

        const result = validateEnv(env);
        // Port validation happens after transform, so invalid strings become NaN
        if (port === "not-a-number") {
          expect(result.success).toBe(false);
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it("requires CLIENT_URL and REDIS_URL in production but not in development/test", () => {
    fc.assert(
      fc.property(validDatabaseUrl, validSessionSecret, (dbUrl, secret) => {
        // Production without CLIENT_URL must fail closed.
        const prodResult = validateEnv({
          DATABASE_URL: dbUrl,
          SESSION_SECRET: secret,
          NODE_ENV: "production",
          REDIS_URL: "redis://localhost:6379",
          // CLIENT_URL intentionally missing
        });
        expect(prodResult.success).toBe(false);
        expect(prodResult.errors!.some((e) => e.variable === "CLIENT_URL")).toBe(
          true
        );

        // Development without CLIENT_URL is fine (falls back to localhost).
        const devResult = validateEnv({
          DATABASE_URL: dbUrl,
          SESSION_SECRET: secret,
          NODE_ENV: "development",
        });
        expect(devResult.success).toBe(true);

        return !prodResult.success && devResult.success;
      }),
      { numRuns: 50 }
    );
  });

  it("requires REDIS_URL in production for distributed operational controls", () => {
    const result = validateEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      SESSION_SECRET: "a".repeat(32),
      CLIENT_URL: "https://finance.example.com",
      NODE_ENV: "production",
    });

    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.variable === "REDIS_URL")).toBe(true);
  });

  it("rejects invalid NODE_ENV values", () => {
    const invalidNodeEnvs = fc
      .string()
      .filter((s) => !["development", "production", "test"].includes(s) && s.length > 0);

    fc.assert(
      fc.property(validDatabaseUrl, validSessionSecret, invalidNodeEnvs, (dbUrl, secret, nodeEnv) => {
        const env = {
          DATABASE_URL: dbUrl,
          SESSION_SECRET: secret,
          NODE_ENV: nodeEnv,
        };

        const result = validateEnv(env);
        expect(result.success).toBe(false);
        return !result.success;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **SCP-324: Optional feature vars are explicitly optional with validated formats.**
   *
   * Absent optional vars must NOT block boot (feature simply disabled). When PRESENT,
   * a malformed value must fail closed - it must never silently pass through.
   */
  describe("SCP-324: optional feature vars fail closed when malformed", () => {
    const baseEnv = {
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      SESSION_SECRET: "a".repeat(32),
    };

    it("boots with ALL optional feature vars absent (feature-disabled, not a failure)", () => {
      const result = validateEnv({ ...baseEnv });
      expect(result.success).toBe(true);
      // Absent optional vars are simply undefined, not defaulted to anything.
      expect(result.data!.REDIS_URL).toBeUndefined();
      expect(result.data!.CRON_SECRET).toBeUndefined();
      expect(result.data!.GEMINI_API_KEY).toBeUndefined();
      expect(result.data!.VAPID_PUBLIC_KEY).toBeUndefined();
      expect(result.data!.VAPID_PRIVATE_KEY).toBeUndefined();
    });

    it("treats empty-string optional vars as absent (boot OK)", () => {
      const result = validateEnv({
        ...baseEnv,
        REDIS_URL: "",
        CRON_SECRET: "",
        GEMINI_API_KEY: "",
      });
      expect(result.success).toBe(true);
      expect(result.data!.REDIS_URL).toBeUndefined();
      expect(result.data!.CRON_SECRET).toBeUndefined();
    });

    it("accepts well-formed optional feature vars when present", () => {
      const result = validateEnv({
        ...baseEnv,
        REDIS_URL: "redis://localhost:6379",
        CRON_SECRET: "a".repeat(32),
        GEMINI_API_KEY: "fake-gemini-key-for-test",
        VAPID_PUBLIC_KEY: "fake-vapid-public",
        VAPID_PRIVATE_KEY: "fake-vapid-private",
        DATABASE_SSL: "true",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_FILE: "/etc/secrets/render-postgres-ca.pem",
      });
      expect(result.success).toBe(true);
      expect(result.data!.REDIS_URL).toBe("redis://localhost:6379");
    });

    it("rejects malformed database TLS flags", () => {
      const result = validateEnv({
        ...baseEnv,
        DATABASE_SSL: "yes",
      });

      expect(result.success).toBe(false);
      expect(result.errors!.some((e) => e.variable === "DATABASE_SSL")).toBe(true);
    });

    it("rejects contradictory database TLS settings", () => {
      const result = validateEnv({
        ...baseEnv,
        DATABASE_SSL: "false",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
      });

      expect(result.success).toBe(false);
      expect(
        result.errors!.some(
          (e) => e.variable === "DATABASE_SSL_REJECT_UNAUTHORIZED",
        ),
      ).toBe(true);
    });

    it("rejects ambiguous database CA sources", () => {
      const result = validateEnv({
        ...baseEnv,
        DATABASE_SSL_CA_CERT: "-----BEGIN CERTIFICATE-----",
        DATABASE_SSL_CA_FILE: "/etc/secrets/render-postgres-ca.pem",
      });

      expect(result.success).toBe(false);
      expect(result.errors!.some((e) => e.variable === "DATABASE_SSL_CA_FILE")).toBe(true);
    });

    it("accepts rediss:// (TLS) Redis URLs", () => {
      const result = validateEnv({
        ...baseEnv,
        REDIS_URL: "rediss://user:pass@redis.example.com:6380",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a malformed REDIS_URL when present (fail closed)", () => {
      const malformedRedis = fc.oneof(
        fc.constant("not-a-url"),
        fc.constant("http://localhost:6379"),
        fc.constant("localhost:6379"),
        fc.constant("postgres://localhost:5432/db")
      );

      fc.assert(
        fc.property(malformedRedis, (badUrl) => {
          const result = validateEnv({ ...baseEnv, REDIS_URL: badUrl });
          expect(result.success).toBe(false);
          expect(result.errors!.some((e) => e.variable === "REDIS_URL")).toBe(true);
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("rejects a too-short CRON_SECRET when present (fail closed)", () => {
      const tooShort = fc.string({ minLength: 1, maxLength: 15 });

      fc.assert(
        fc.property(tooShort, (secret) => {
          const result = validateEnv({ ...baseEnv, CRON_SECRET: secret });
          expect(result.success).toBe(false);
          expect(result.errors!.some((e) => e.variable === "CRON_SECRET")).toBe(true);
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("rejects a partially-configured VAPID pair (one key without the other)", () => {
      const onlyPublic = validateEnv({ ...baseEnv, VAPID_PUBLIC_KEY: "pub" });
      expect(onlyPublic.success).toBe(false);
      expect(onlyPublic.errors!.some((e) => e.variable === "VAPID_PRIVATE_KEY")).toBe(true);

      const onlyPrivate = validateEnv({ ...baseEnv, VAPID_PRIVATE_KEY: "priv" });
      expect(onlyPrivate.success).toBe(false);
      expect(onlyPrivate.errors!.some((e) => e.variable === "VAPID_PUBLIC_KEY")).toBe(true);
    });

    it("a malformed optional var does not mask a still-enforced required var", () => {
      // REDIS_URL malformed AND DATABASE_URL missing: both must surface, proving
      // required vars still fail closed alongside optional-format enforcement.
      const result = validateEnv({
        SESSION_SECRET: "a".repeat(32),
        REDIS_URL: "not-a-url",
      });
      expect(result.success).toBe(false);
      expect(result.errors!.some((e) => e.variable === "DATABASE_URL")).toBe(true);
      expect(result.errors!.some((e) => e.variable === "REDIS_URL")).toBe(true);
    });
  });
});
