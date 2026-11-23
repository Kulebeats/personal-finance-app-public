import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { resolveDatabaseConnection } from "./server/dbSsl";

// Generation reads only schema. Driver commands require credentials, and
// Drizzle's own validation refuses their absence before creating a driver.
const connection = process.env.DATABASE_URL ? resolveDatabaseConnection() : undefined;

export default defineConfig({
  out: "./migrations",
  schema: ["./shared/schema.ts", "./shared/grz-bond-valuation-schema.ts", "./shared/grz-principal-basis-schema.ts", "./shared/grz-principal-settlement-schema.ts"],
  dialect: "postgresql",
  dbCredentials: connection && {
    host: connection.host, port: connection.port, database: connection.database,
    user: connection.user, ...(connection.password ? { password: connection.password } : {}), ssl: connection.ssl,
  },
});
