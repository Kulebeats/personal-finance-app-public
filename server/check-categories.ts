import { pool } from "./db.js";

async function checkHouseholdCategories() {
  try {
    // Get all households
    const households = await pool.query("SELECT id, name FROM households");
    console.log("\n=== Households ===");
    households.rows.forEach((h) => {
      console.log(`ID: ${h.id}, Name: ${h.name}`);
    });

    // For each household, count categories
    for (const household of households.rows) {
      const catCount = await pool.query(
        "SELECT COUNT(*) FROM categories WHERE household_id = $1",
        [household.id]
      );
      const groupCount = await pool.query(
        "SELECT COUNT(*) FROM category_groups WHERE household_id = $1",
        [household.id]
      );
      console.log(`\nHousehold "${household.name}":`);
      console.log(`  Categories: ${catCount.rows[0].count}`);
      console.log(`  Groups: ${groupCount.rows[0].count}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkHouseholdCategories();
