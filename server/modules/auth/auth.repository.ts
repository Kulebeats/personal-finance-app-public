/**
 * Auth Module Repository
 *
 * Data access layer - only database operations.
 * No business logic here.
 *
 * DESIGN NOTE: Repository Delegation Pattern
 * ==========================================
 * This repository handles auth-specific queries (user lookup, lockout management).
 * Complex user operations (sessions, login history, display settings) are delegated
 * to UserRepository from server/repositories/UserRepository.ts to maintain a
 * single source of truth for user data access.
 *
 * The auth.service.ts imports both repositories:
 * - authRepository: User lookup, password updates, lockout management
 * - userRepository: Sessions, login history, notification preferences
 *
 * This intentional split avoids duplicating UserRepository's comprehensive
 * methods while keeping auth-specific operations local to this module.
 *
 * @module modules/auth/auth.repository
 */

import { db } from "../../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { sameEmail, userRepository } from "../../repositories/UserRepository";

/**
 * User data for creation
 */
interface CreateUserData {
  email: string;
  username: string;
  passwordHash: string;
  fullName?: string;
}

/**
 * Auth Repository
 *
 * All user data access operations.
 */
export const authRepository = {
  /**
   * Find user by email
   */
  async findByEmail(email: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(sameEmail(email))
      .limit(1);
    return user || null;
  },

  /**
   * Find user by username
   */
  async findByUsername(username: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return user || null;
  },

  /**
   * Find user by ID
   */
  async findById(id: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user || null;
  },

  /**
   * Create new user
   */
  async createUser(data: CreateUserData) {
    return userRepository.create({
      email: data.email,
      username: data.username,
      passwordHash: data.passwordHash,
      fullName: data.fullName,
    });
  },

  /**
   * Increment failed login attempts
   */
  async incrementFailedAttempts(userId: string) {
    const [user] = await db
      .update(users)
      .set({
        failedLoginAttempts: sql`COALESCE(${users.failedLoginAttempts}, 0) + 1`,
        lastFailedLoginAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  },

  /**
   * Reset failed login attempts
   */
  async resetFailedAttempts(userId: string) {
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  /**
   * Lock user account
   */
  async lockAccount(userId: string, lockedUntil: Date) {
    await db.update(users).set({ lockedUntil }).where(eq(users.id, userId));
  },

  /**
   * Unlock user account
   */
  async unlockAccount(userId: string) {
    await db
      .update(users)
      .set({
        lockedUntil: null,
        failedLoginAttempts: 0,
      })
      .where(eq(users.id, userId));
  },

  /**
   * Update password
   */
  async updatePassword(userId: string, passwordHash: string) {
    await db
      .update(users)
      .set({
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },
};
