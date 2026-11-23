/** Compatibility entrypoint; no ambient URL derivation is permitted. */
export { resolveTestDatabaseUrl, assertNotDevDatabase } from "./test-target.mjs";
export type { TestTarget, TargetEnvironment as ResolveOptions } from "./test-target.mjs";
