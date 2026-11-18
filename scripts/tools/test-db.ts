import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

console.log("Checking DB connection...");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing from environment");
  process.exit(1);
}

console.log(
  "URL found (starts with):",
  process.env.DATABASE_URL.substring(0, 15) + "..."
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

(async () => {
  try {
    const client = await pool.connect();
    console.log("Connected successfully!");
    const res = await client.query("SELECT 1 as val");
    console.log("Query result:", res.rows[0]);

    // Check tables
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log(
      "Tables found:",
      tables.rows.map((r) => r.table_name)
    );

    client.release();
    await pool.end();
  } catch (err: any) {
    console.error("Connection failed:", err.message);
    if (err.code) console.error("Error code:", err.code);
    process.exit(1);
  }
})();
