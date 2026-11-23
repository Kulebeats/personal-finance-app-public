// Retained only to fail closed: no application imports, dotenv, connection or writes.
console.error("DEPRECATED UNSAFE TEST ENTRYPOINT: use PFA_TEST_MODE=database with explicit TEST_DATABASE_URL, TEST_RUN_ID and TEST_TARGET_MANIFEST; then run node scripts/protected-test-tool.mjs diagnose|fixture. Fixture creation also requires TEST_FIXTURE_PASSWORD and creates only run-scoped synthetic identities.");
process.exitCode = 1;
