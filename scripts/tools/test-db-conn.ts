import { pool } from "./server/db";

async function testConnection() {
  try {
    console.log("Testing database connection...");
    const res = await pool.query("SELECT NOW() as time");
    console.log("Connection successful:", res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error("Connection failed:", err);
    process.exit(1);
  }
}

testConnection();
