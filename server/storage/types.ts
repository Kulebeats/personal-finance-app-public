import type {
  User,
  InsertUser,
  DisplaySettings,
  InsertDisplaySettings,
  NotificationPreference,
  InsertNotificationPreference,
  UserPreferences,
  InsertUserPreferences,
  UserAIPreferences,
  InsertUserAIPreferences,
  Household,
  InsertHousehold,
  Category,
  InsertCategory,
  CategoryGroup,
  InsertCategoryGroup,
  householdMembers,
} from "@shared/schema";
import type { InferSelectModel } from "drizzle-orm";

export type HouseholdMember = InferSelectModel<typeof householdMembers>;

/**
 * @deprecated Use domain repositories instead (e.g. AccountRepository).
 */
export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;

  // Display settings methods
  getDisplaySettings(userId: string): Promise<DisplaySettings | undefined>;
  createDisplaySettings(
    settings: InsertDisplaySettings
  ): Promise<DisplaySettings>;
  updateDisplaySettings(
    userId: string,
    data: Partial<DisplaySettings>
  ): Promise<DisplaySettings | undefined>;

  // Notification preferences methods
  getNotificationPreferences(userId: string): Promise<NotificationPreference[]>;
  createNotificationPreference(
    pref: InsertNotificationPreference
  ): Promise<NotificationPreference>;
  updateNotificationPreference(
    userId: string,
    notificationType: string,
    data: Partial<NotificationPreference>
  ): Promise<NotificationPreference | undefined>;

  // User preferences methods
  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  createUserPreferences(userId: string): Promise<UserPreferences>;
  updateUserPreferences(
    userId: string,
    data: Partial<UserPreferences>
  ): Promise<UserPreferences | undefined>;

  // User AI preferences methods
  getUserAIPreferences(userId: string): Promise<UserAIPreferences | undefined>;
  createUserAIPreferences(userId: string): Promise<UserAIPreferences>;
  updateUserAIPreferences(
    userId: string,
    data: Partial<UserAIPreferences>
  ): Promise<UserAIPreferences | undefined>;

  // Household methods
  getHousehold(id: string): Promise<Household | undefined>;
  getHouseholdByUserId(userId: string): Promise<Household | undefined>;
  createHousehold(household: InsertHousehold): Promise<Household>;
  updateHousehold(
    id: string,
    data: Partial<Household>
  ): Promise<Household | undefined>;

  // Household member methods
  getHouseholdMembership(householdId: string, userId: string): Promise<HouseholdMember | undefined>;
  getHouseholdMember(householdId: string, userId: string): Promise<HouseholdMember | undefined>;

  // Category methods
  getCategoriesByHousehold(householdId: string): Promise<Category[]>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(
    id: string,
    data: Partial<Category>
  ): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<void>;

  // Category group methods
  getCategoryGroups(householdId: string): Promise<CategoryGroup[]>;
  createCategoryGroup(group: InsertCategoryGroup): Promise<CategoryGroup>;
  updateCategoryGroup(
    id: string,
    data: Partial<CategoryGroup>
  ): Promise<CategoryGroup | undefined>;
}
