import { prepareTestEnvironment } from "./test-target.mjs";
import { installNetworkGuard } from "./network-guard.mjs";
import { installPostgresGuard } from "./postgres-guard.mjs";

const environment = prepareTestEnvironment();
installNetworkGuard(environment);
await installPostgresGuard(environment);

// R17: paid providers fail closed without an operator call cap. Suites that
// stub a configured provider get a generous test cap; the cap suites unset it
// with vi.stubEnv to prove the fail-closed path. No key is ever set here.
process.env.AI_ANTHROPIC_DAILY_CALL_CAP ??= "100000";
process.env.AI_GEMINI_DAILY_CALL_CAP ??= "100000";
