import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

console.log("Testing database connection...");
console.log("DATABASE_URL:", process.env.DATABASE_URL);

pool.query("SELECT 1")
  .then(() => {
    console.log("✓ Database connection successful");
    return pool.end();
  })
  .catch((err) => {
    console.error("✗ Database connection failed:", err.message);
    process.exit(1);
  });
