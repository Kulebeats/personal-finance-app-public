declare const privateRedisCredential: unique symbol;

/** Opaque authority; public JSON and manifest references cannot construct it. */
export type PrivateRedisCredentialCapability = Readonly<{ [privateRedisCredential]: true }>;
export interface RedisCredentialOwner { revoke(): void }
export interface RedisCredentialProjection {
  readonly runId: string;
  readonly credentialRef: string;
  readonly credentialGeneration: string;
  readonly instanceId: string;
  readonly ownershipReceiptId: string;
}

/** All boundary inputs are runtime-branded. Does not authorize process launch. */
export function createRedisCredentials(manifest: unknown): Readonly<{
  capability: PrivateRedisCredentialCapability;
  owner: Readonly<RedisCredentialOwner>;
}>;
export function withRedisProvisioningSecret<T>(capability: PrivateRedisCredentialCapability,
  producerAction: (secret: string) => Promise<T>): Promise<T>;
/** Producer OwnedRedisService is checked at runtime; no public projection admits. */
export function bindRedisCredentials(capability: PrivateRedisCredentialCapability, service: unknown): Promise<void>;
export function requireRedisCredentials(capability: PrivateRedisCredentialCapability, service: unknown): Readonly<RedisCredentialProjection>;
export function withRedisConnectionSecret<T>(capability: PrivateRedisCredentialCapability,
  service: unknown, action: (secret: string) => Promise<T>): Promise<T>;
export function onRedisCredentialsRevoked(capability: PrivateRedisCredentialCapability, callback: () => void): () => void;
