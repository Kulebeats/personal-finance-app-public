export type RateLimitScript = Readonly<{ text: string; sha1: string; sha256: string }>;
export const RATE_LIMIT_SCRIPTS: Readonly<{ increment: RateLimitScript; get: RateLimitScript }>;
export type RateLimitCommand = Readonly<{ operation: 'script-load'; scriptSha1: string; command: readonly string[] }> |
  Readonly<{ operation: 'increment' | 'get' | 'decrement' | 'delete'; command: readonly string[] }>;
export function parseRateLimitCommand(runPrefix: string, command: readonly string[]): RateLimitCommand;
