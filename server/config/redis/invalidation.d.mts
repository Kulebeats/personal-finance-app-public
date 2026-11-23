export interface RedisInvalidationBinding {
  assertCurrent(): void;
  validateKey(physicalKey: string): void;
  includeKey(physicalKey: string): boolean;
  scan(cursor: string, physicalPattern: string, count: number): Promise<readonly [string, readonly string[]]>;
  deleteBatch(physicalKeys: readonly string[]): Promise<number>;
}
export type RedisInvalidationBounds = Readonly<{ maxScans: number; maxKeys: number; batchSize: number }>;
export function deleteByPatterns(binding: RedisInvalidationBinding, patterns: readonly string[], bounds?: RedisInvalidationBounds): Promise<number>;
