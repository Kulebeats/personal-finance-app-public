import { prepareTestEnvironment, parseConnection, verifyDatabaseTarget } from "../test-target.mjs";
import { installNetworkGuard } from "../network-guard.mjs";
import { installPostgresGuard } from "../postgres-guard.mjs";
import type { Client } from "pg";

/** Every fixture/readback uses the same persisted target and per-client guards. */
export async function withFixtureClient<T>(operation: (client: Client, runId: string) => Promise<T>): Promise<T> {
  const environment = prepareTestEnvironment();
  if (environment.mode !== "database") throw new Error("Completion fixtures require database mode");
  installNetworkGuard(environment);
  await installPostgresGuard(environment);
  const target = await verifyDatabaseTarget();
  const { default: pg } = await import("pg");
  const client = new pg.Client(parseConnection(process.env.TEST_DATABASE_URL!));
  await client.connect();
  try { return await operation(client, target.runId); }
  finally { await client.end(); }
}
