import type { ProductionRedisOperationBinding } from './production-operations.mjs';
export interface ProductionRedisLifetime extends ProductionRedisOperationBinding {
  /** Owner must check this before returning successful close evidence. */
  assertClean(): void;
  onRevoked(callback: () => void): () => void;
}
/** Private plumbing over a trusted owner channel; cannot mint actual admission. */
export function createProductionRedisLifetime(input: Readonly<{
  assertAuthority(): void;
  dispatch(command: readonly string[]): Promise<unknown>;
  disconnect(): void;
  commandTimeoutMs: number;
  operationTimeoutMs: number;
}>): Readonly<ProductionRedisLifetime>;
