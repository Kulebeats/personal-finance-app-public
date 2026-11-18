import "dotenv/config";
import { storage } from "./server/storage";
import { hashPassword } from "./server/auth";
import {
  seedDefaultCategories,
  seedDefaultNotificationPreferences,
  seedDefaultMerchants,
} from "./server/seed";

async function createTestUser() {
  try {
    const email = "test@example.com";
    const password = "Password123!";
    const username = "testuser";

    // Check if user exists
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      console.log("Test user already exists:");
      console.log("Email:", email);
      console.log("Password:", password);
      process.exit(0);
    }

    console.log("Creating test user...");
    const passwordHash = await hashPassword(password);

    const user = await storage.createUser({
      username,
      email,
      passwordHash,
      fullName: "Test User",
      timezone: "UTC",
    });

    console.log("User created:", user.id);

    console.log("Seeding user defaults...");
    // Create default display settings
    await storage.createDisplaySettings({
      userId: user.id,
      theme: "system",
      currency: "ZMW",
      numberFormat: "US",
      dateFormat: "MM/DD/YYYY",
      firstDayOfWeek: "Sunday",
      viewMode: "comfortable",
    });

    // Seed default notification preferences
    await seedDefaultNotificationPreferences(user.id);

    // Create a household
    const household = await storage.createHousehold({
      name: "Test Household",
      currency: "ZMW",
    });

    await storage.addHouseholdMember({
      householdId: household.id,
      userId: user.id,
      role: "owner",
    });

    await storage.createHouseholdPreferences({
      householdId: household.id,
    });

    await seedDefaultCategories(household.id);
    await seedDefaultMerchants(household.id);

    console.log("\n✅ Test account created successfully!");
    console.log("Email:", email);
    console.log("Password:", password);

    process.exit(0);
  } catch (err) {
    console.error("Failed to create test user:", err);
    process.exit(1);
  }
}

createTestUser();
