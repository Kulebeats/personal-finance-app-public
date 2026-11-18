import { db } from "../server/db";
import { users } from "@shared/schema";
import { hashPassword } from "../server/auth";
import { eq, or } from "drizzle-orm";

async function main() {
  const targetUsername = "testuser";
  const targetEmail = "test@test.com";
  const rawPassword = "Kb123!";

  try {
    console.log(
      `Checking for existing user matching ${targetUsername} or ${targetEmail}...`
    );

    // Find if user exists by email OR username
    const existingUser = await db.query.users.findFirst({
      where: or(
        eq(users.email, targetEmail),
        eq(users.username, targetUsername)
      ),
    });

    console.log("Hashing password...");
    const hashedPassword = await hashPassword(rawPassword);

    if (existingUser) {
      console.log(
        `User found (ID: ${existingUser.id}). Updating credentials...`
      );

      // Update the existing user to match the requested credentials
      await db
        .update(users)
        .set({
          username: targetUsername,
          email: targetEmail,
          passwordHash: hashedPassword,
          fullName: "Test User", // Ensure profile has a name
        })
        .where(eq(users.id, existingUser.id));

      console.log("User updated successfully.");
    } else {
      console.log("User not found. Creating new user...");

      const [newUser] = await db
        .insert(users)
        .values({
          username: targetUsername,
          email: targetEmail,
          passwordHash: hashedPassword,
          fullName: "Test User",
          displayName: "Test User",
        })
        .returning();

      console.log(`User created successfully (ID: ${newUser.id}).`);
    }
  } catch (error) {
    console.error("Failed to process user:", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
