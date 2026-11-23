export interface TestTarget {
  version: 1; disposable: true; synthetic: true; host: string; port: number;
  database: string; runId: string; server?: { origin: string };
}
export interface TargetEnvironment {
  [key: string]: string | TestTarget | undefined;
  TEST_TARGET?: TestTarget; TEST_DATABASE_URL?: string; DATABASE_URL?: string;
  TEST_TARGET_MANIFEST?: string; TEST_RUN_ID?: string;
}
export function validateManifest(target: unknown, runId?: string): TestTarget;
export function loadTestTarget(env?: TargetEnvironment): TestTarget;
export function parseConnection(url: string, label?: string): {
  host: string; port: number; database: string; user: string; password: string;
  ssl: false; connectionTimeoutMillis: number;
};
export function resolveTestDatabaseUrl(env: TargetEnvironment): string;
export function assertNotDevDatabase(url: string, ambient?: string, env?: TargetEnvironment): void;
export function markerFor(target: TestTarget): string;
export function assertDatabaseIdentity(rows: Array<{ database: string; host: string; port: number; marker: string }>, target: TestTarget): void;
export function verifyDatabaseTarget(env?: TargetEnvironment): Promise<TestTarget>;
export function prepareTestEnvironment(env?: NodeJS.ProcessEnv, options?: { defaultUnit?: boolean }): { mode: 'unit' | 'database'; target?: TestTarget };
