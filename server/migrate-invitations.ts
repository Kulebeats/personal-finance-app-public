import "dotenv/config";
import { pool } from "./db.js";

async function migrate() {
  console.log("Running migration: Create household_invitations table");

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS household_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        household_id UUID REFERENCES households(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        invitation_token TEXT NOT NULL UNIQUE,
        invited_by UUID REFERENCES users(id),
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("✓ Successfully created household_invitations table");

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_household_invitations_email 
      ON household_invitations(email);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_household_invitations_token 
      ON household_invitations(invitation_token);
    `);

    console.log("✓ Created indexes");
    console.log("✓ Migration complete!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
