/**
 * WebAuthn/Passkey Strategy (P3-44)
 *
 * NOT YET IMPLEMENTED - Requires:
 * - @simplewebauthn/server package
 * - @simplewebauthn/browser (client-side)
 * - HTTPS in production (WebAuthn requires secure context)
 * - Database table for credential storage
 *
 * Implementation Guide:
 * 1. npm install @simplewebauthn/server @simplewebauthn/browser
 * 2. Add webauthn_credentials table to schema
 * 3. Implement registration and authentication flows
 * 4. Add client-side WebAuthn UI components
 *
 * @module modules/auth/strategies/webauthn
 */

// import {
//   generateRegistrationOptions,
//   verifyRegistrationResponse,
//   generateAuthenticationOptions,
//   verifyAuthenticationResponse,
// } from "@simplewebauthn/server";
// import type {
//   RegistrationResponseJSON,
//   AuthenticationResponseJSON,
// } from "@simplewebauthn/types";

/**
 * SEC-CONFIG-004: WebAuthn Configuration with safe defaults
 * In production, environment variables are REQUIRED - no unsafe fallbacks
 */
function getWebAuthnConfig() {
  const isProduction = process.env.NODE_ENV === "production";

  // In production, these are required - no fallbacks
  let rpID = process.env.WEBAUTHN_RP_ID;
  let origin = process.env.WEBAUTHN_ORIGIN;

  if (isProduction) {
    if (!rpID || !origin) {
      // Log warning but don't throw - WebAuthn may not be enabled
      // Using console.warn here since this runs at module load time before logger may be ready
      // eslint-disable-next-line no-console
      console.warn(
        "SEC-CONFIG-004: WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN required in production"
      );
    }
  } else {
    // Development-only fallbacks
    rpID = rpID || "localhost";
    origin = origin || "http://localhost:5000";
  }

  return {
    rpName: "Personal Finance App",
    rpID: rpID || "",
    origin: origin || "",
    // Timeout for WebAuthn operations (5 minutes)
    timeout: 300000,
    // Supported authenticator types
    authenticatorSelection: {
      // Platform authenticators (Touch ID, Windows Hello)
      authenticatorAttachment: "platform" as const,
      // Require user verification (biometric/PIN)
      userVerification: "required" as const,
      // Discoverable credentials (passkeys)
      residentKey: "required" as const,
    },
  };
}

export const WEBAUTHN_CONFIG = getWebAuthnConfig();

/**
 * Check if WebAuthn is available (requires HTTPS in production)
 */
export function isWebAuthnAvailable(): boolean {
  // WebAuthn requires HTTPS in production
  if (process.env.NODE_ENV === "production") {
    return WEBAUTHN_CONFIG.origin.startsWith("https://");
  }
  // Allow localhost in development
  return true;
}

/**
 * WebAuthn Credential Storage Interface
 *
 * Add this table to shared/schema.ts:
 *
 * export const webauthnCredentials = pgTable("webauthn_credentials", {
 *   id: uuid("id").primaryKey().defaultRandom(),
 *   userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
 *   credentialId: text("credential_id").notNull().unique(),
 *   publicKey: text("public_key").notNull(),
 *   counter: integer("counter").notNull().default(0),
 *   deviceType: varchar("device_type", { length: 50 }),
 *   backedUp: boolean("backed_up").default(false),
 *   transports: jsonb("transports").$type<string[]>(),
 *   createdAt: timestamp("created_at").defaultNow(),
 *   lastUsedAt: timestamp("last_used_at"),
 * });
 */

/**
 * Generate registration options for new passkey
 *
 * @example
 * // POST /api/auth/webauthn/register/options
 * const options = await generatePasskeyRegistrationOptions(user);
 * // Store challenge in session
 * req.session.webauthnChallenge = options.challenge;
 * res.json(options);
 */
export async function generatePasskeyRegistrationOptions(user: {
  id: string;
  email: string;
  fullName?: string | null;
}): Promise<object> {
  // TODO: Implement when @simplewebauthn/server is installed
  // return generateRegistrationOptions({
  //   rpName: WEBAUTHN_CONFIG.rpName,
  //   rpID: WEBAUTHN_CONFIG.rpID,
  //   userID: user.id,
  //   userName: user.email,
  //   userDisplayName: user.fullName || user.email,
  //   timeout: WEBAUTHN_CONFIG.timeout,
  //   authenticatorSelection: WEBAUTHN_CONFIG.authenticatorSelection,
  //   attestationType: "none", // We don't need attestation
  //   excludeCredentials: [], // TODO: Fetch existing credentials
  // });

  throw new Error("WebAuthn not implemented - install @simplewebauthn/server");
}

/**
 * Verify registration response and store credential
 *
 * @example
 * // POST /api/auth/webauthn/register/verify
 * const verification = await verifyPasskeyRegistration(
 *   req.body,
 *   req.session.webauthnChallenge
 * );
 * if (verification.verified) {
 *   await storeCredential(userId, verification.registrationInfo);
 * }
 */
export async function verifyPasskeyRegistration(
  response: unknown,
  expectedChallenge: string
): Promise<{ verified: boolean; registrationInfo?: unknown }> {
  // TODO: Implement when @simplewebauthn/server is installed
  throw new Error("WebAuthn not implemented - install @simplewebauthn/server");
}

/**
 * Generate authentication options for passkey login
 *
 * @example
 * // POST /api/auth/webauthn/authenticate/options
 * const options = await generatePasskeyAuthenticationOptions(email);
 * req.session.webauthnChallenge = options.challenge;
 * res.json(options);
 */
export async function generatePasskeyAuthenticationOptions(
  email?: string
): Promise<object> {
  // TODO: Implement when @simplewebauthn/server is installed
  throw new Error("WebAuthn not implemented - install @simplewebauthn/server");
}

/**
 * Verify authentication response
 *
 * @example
 * // POST /api/auth/webauthn/authenticate/verify
 * const verification = await verifyPasskeyAuthentication(
 *   req.body,
 *   req.session.webauthnChallenge
 * );
 * if (verification.verified) {
 *   // Log user in
 *   req.session.userId = verification.userId;
 * }
 */
export async function verifyPasskeyAuthentication(
  response: unknown,
  expectedChallenge: string
): Promise<{ verified: boolean; userId?: string }> {
  // TODO: Implement when @simplewebauthn/server is installed
  throw new Error("WebAuthn not implemented - install @simplewebauthn/server");
}
