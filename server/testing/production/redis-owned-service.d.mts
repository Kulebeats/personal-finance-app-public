declare const ownedRedisService: unique symbol;
export interface OwnedRedisService { readonly [ownedRedisService]: true }
export interface OwnedRedisServiceProjection {
  readonly kind: 'owned-redis-service';
  readonly runId: string;
  readonly instanceId: string;
  readonly endpoint: Readonly<{ host: '127.0.0.1'; port: number }>;
  readonly serverVersion: '7.0.15';
  readonly database: 0;
  readonly aclUser: string;
  readonly keyPrefix: string;
  readonly credentialRef: string;
  readonly credentialGeneration: string;
  readonly expectedRedisRunId: string;
  readonly ownershipReceiptId: string;
}
export interface OwnedRedisShutdown {
  readonly kind: 'owned-redis-shutdown';
  readonly cleanupVerified: boolean;
  readonly notLaunched?: boolean;
  readonly redisNotLaunched?: boolean;
  readonly processTerminated?: boolean;
  readonly linuxListenerClosed?: boolean;
  readonly endpointClosed?: boolean;
  readonly windowsProcessExited?: boolean;
  readonly hostIdentityStable?: boolean;
  readonly recoveryUsed?: boolean;
  readonly connectionClosed: boolean;
  readonly authorityRevoked: boolean;
  readonly observerFailure: boolean;
  readonly runId: string;
  readonly instanceId: string;
  readonly ownershipReceiptId: string | null;
}
/** Trusted local bootstrap only; consistency inputs do not authorize execution. */
export function startOwnedRedisService(manifest: unknown, credentials: unknown): Promise<Readonly<{
  service: OwnedRedisService;
  owner: Readonly<{ stop(): Promise<OwnedRedisShutdown>; revoke(): void; ownershipReceipt: Readonly<Record<string, unknown>> }>;
}>>;
export function requireOwnedRedisService(service: unknown): OwnedRedisServiceProjection;
export function onOwnedRedisServiceRevoked(service: unknown, callback: () => void): () => void;
/** Trusted factory only; these expectations must not enter application evidence. */
export function withOwnedRedisIdentity<T>(service: unknown, action: (expected: Readonly<{
  markerKey: string; markerValue: string; expectedRedisRunId: string;
}>) => Promise<T>): Promise<T>;
