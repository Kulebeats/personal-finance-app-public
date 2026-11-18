/**
 * Script to seed system roles and assign super_admin to first user
 * Run with: npx tsx scripts/seed-system-roles.ts
 */

import { db } from "../server/db";
import { systemRoles, userSystemRoles, users } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Seeding system roles...");

  // Seed default roles
  const defaultRoles = [
    {
      name: "super_admin",
      description: "Full system access - can manage all users and settings",
      permissions: ["*"],
    },
    {
      name: "support",
      description:
        "Customer support - can view user data with limited write access",
      permissions: ["users.read", "logs.read", "households.read"],
    },
    {
      name: "analyst",
      description:
        "Data analyst - read-only access to system metrics and reports",
      permissions: ["metrics.read", "logs.read", "reports.read"],
    },
    {
      name: "readonly_admin",
      description:
        "Read-only admin - can view admin dashboard but not modify anything",
      permissions: ["admin.read"],
    },
  ];

  for (const role of defaultRoles) {
    const existing = await db
      .select()
      .from(systemRoles)
      .where(eq(systemRoles.name, role.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(systemRoles).values(role);
      console.log(`  Created role: ${role.name}`);
    } else {
      console.log(`  Role exists: ${role.name}`);
    }
  }

  // Get super_admin role
  const superAdminRole = await db
    .select()
    .from(systemRoles)
    .where(eq(systemRoles.name, "super_admin"))
    .limit(1);

  if (superAdminRole.length === 0) {
    console.error("Failed to find super_admin role!");
    process.exit(1);
  }

  // Find first user (by creation date)
  const firstUser = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(users.createdAt)
    .limit(1);

  if (firstUser.length === 0) {
    console.log(
      "No users found. Create a user first, then run this script again."
    );
    process.exit(0);
  }

  // Check if already assigned
  const existingAssignment = await db
    .select()
    .from(userSystemRoles)
    .where(eq(userSystemRoles.userId, firstUser[0].id))
    .limit(1);

  if (existingAssignment.length > 0) {
    console.log(
      `User ${firstUser[0].email} already has a system role assigned.`
    );
  } else {
    await db.insert(userSystemRoles).values({
      userId: firstUser[0].id,
      roleId: superAdminRole[0].id,
    });
    console.log(`Assigned super_admin role to: ${firstUser[0].email}`);
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
