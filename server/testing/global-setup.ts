import { prepareTestEnvironment, verifyDatabaseTarget } from "./test-target.mjs";

export default async function setup() {
  const { mode } = prepareTestEnvironment();
  if (mode === "database") await verifyDatabaseTarget();
}
