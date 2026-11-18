import "dotenv/config";
import { pool } from "./db.js";

async function migrate() {
  console.log("Running migration: Merchant Schema Sync");

  try {
    const columns = [
      { name: "logo_url", type: "TEXT" },
      { name: "category", type: "VARCHAR(100)" },
      { name: "default_category_id", type: "UUID REFERENCES categories(id)" },
      { name: "notes", type: "TEXT" },
      { name: "is_active", type: "BOOLEAN DEFAULT true" },
      { name: "icon_type", type: "VARCHAR(20) DEFAULT 'logo'" },
      { name: "custom_icon", type: "TEXT" },
      { name: "transaction_count", type: "INTEGER DEFAULT 0" },
      { name: "last_transaction_date", type: "DATE" },
    ];

    for (const column of columns) {
      await pool.query(`
        ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS ${column.name} ${column.type};
      `);
      console.log(`Added/checked column: ${column.name}`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_logo_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        original_filename VARCHAR(255) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_merchant_logo_uploads_merchant
      ON merchant_logo_uploads(merchant_id);
    `);
    console.log("Checked merchant_logo_uploads table");

    console.log("\nMerchant schema migration complete.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
