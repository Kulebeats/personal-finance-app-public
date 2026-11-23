import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareTestEnvironment, verifyDatabaseTarget } from "./test-target.mjs";
import { installNetworkGuard } from "./network-guard.mjs";
import { installPostgresGuard } from "./postgres-guard.mjs";

const environment = prepareTestEnvironment();
installNetworkGuard(environment);
await installPostgresGuard(environment);
if (environment.mode === "database") await verifyDatabaseTarget();
const script = process.argv[2];
if (!script) throw new Error("A protected script path is required");
await import(pathToFileURL(path.resolve(script)).href);
