import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  uuid,
  timestamp,
  boolean,
  integer,
  decimal,
  date,
  time,
  inet,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

export const householdRoleEnum = pgEnum("household_role", [
  "owner",
  "admin",
  "member",
  "view_only",
  "professional",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "checking",
  "savings",
  "credit",
  "cash",
  "mobile_money",
  "investment",
  "loan",
  "mortgage",
  "other_liability",
  "real_estate",
  "vehicle",
  "other",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
  "balance_adjustment",
]);

export const transactionSourceEnum = pgEnum("transaction_source", [
  "manual",
  "whatsapp",
  "receipt_scan",
  "csv_import",
  "recurring",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "cleared",
  "reconciled",
]);

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semi_annually",
  "annually",
  "yearly",
  "custom",
]);

export const goalTypeEnum = pgEnum("goal_type_enum", [
  "save_up",
  "pay_down",
  "investment",
]);
export const goalStatusEnum = pgEnum("goal_status_enum", [
  "on_track",
  "behind",
  "at_risk",
  "completed",
]);
export const goalProgressSourceEnum = pgEnum("goal_progress_source", [
  "contributions",
  "holdings",
]);
export const payoffMethodEnum = pgEnum("payoff_method_enum", [
  "avalanche",
  "snowball",
  "custom",
]);
export const assignmentTypeEnum = pgEnum("assignment_type_enum", [
  "full_balance",
  "partial_balance",
]);
export const linkTypeEnum = pgEnum("link_type_enum", [
  "contribution",
  "spending",
]);

// ============================================================================
// INVESTMENT ENUMS
// ============================================================================

export const securityTypeEnum = pgEnum("security_type", [
  "stock",
  "bond",
  "etf",
  "mutual_fund",
  "unit_trust",
  "term_deposit",
  "tbill",
  "forex",
  "crypto",
  "other",
]);

export const securityExchangeEnum = pgEnum("security_exchange", [
  "luse",
  "nyse",
  "nasdaq",
  "jse",
  "otc",
  "boz",
  "manual",
]);

export const investmentTransactionTypeEnum = pgEnum(
  "investment_transaction_type",
  [
    "buy",
    "sell",
    "dividend",
    "interest",
    "fee",
    "split",
    "transfer_in",
    "transfer_out",
    "coupon",
    "maturity",
  ],
);

export const grzBondPaymentStatusEnum = pgEnum("grz_bond_payment_status", [
  "scheduled",
  "paid",
  "missed",
]);

export const grzSecurityStatusEnum = pgEnum("grz_security_status", [
  "active",
  "matured",
  "sold",
  "rolled_over",
]);

export const investmentNotificationTypeEnum = pgEnum(
  "investment_notification_type",
  [
    "maturity_reminder",
    "coupon_payment",
    "auction_results",
    "price_alert",
    "nav_update",
    "goal_milestone",
    "recurring_execution",
    "stale_price",
  ],
);

// ============================================================================
// SYSTEM ROLES (RBAC)
// ============================================================================

export const systemRoleEnum = pgEnum("system_role", [
  "super_admin", // Full system access
  "support", // Can view user data, limited write
  "analyst", // Read-only access to metrics
  "readonly_admin", // Read-only admin dashboard
]);

export const systemRoles = pgTable("system_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  description: text("description"),
  permissions: jsonb("permissions").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userSystemRoles = pgTable(
  "user_system_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    grantedBy: uuid("granted_by"),
    grantedAt: timestamp("granted_at").defaultNow(),
  },
  (table) => ({
    uniqueUserRole: uniqueIndex("unique_user_role").on(
      table.userId,
      table.roleId,
    ),
    userIdx: index("idx_user_system_roles_user_id").on(table.userId),
    roleIdx: index("idx_user_system_roles_role_id").on(table.roleId),
  }),
);

// ============================================================================
// SECURITY AUDIT LOGGING
// ============================================================================

export const securityAuditLogs = pgTable("security_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  userId: uuid("user_id"), // User who performed the action
  targetUserId: uuid("target_user_id"), // User affected by the action (if different)
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
},
(table) => ({
  eventTypeIdx: index("idx_security_audit_logs_event_type").on(
    table.eventType,
  ),
  userIdx: index("idx_security_audit_logs_user_id").on(table.userId),
  createdAtIdx: index("idx_security_audit_logs_created_at").on(
    table.createdAt.desc(),
  ),
  combinedIdx: index("idx_security_audit_logs_combined").on(
    table.eventType,
    table.createdAt.desc(),
  ),
}));

// ============================================================================
// USERS AND AUTHENTICATION
// ============================================================================

export const users = pgTable("users", {
  // Core fields
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),

  // Email verification
  emailVerified: boolean("email_verified").default(false),
  // SHA-256 hash (hex) of the verification/change token, never the raw
  // value - see server/core/tokenHash.ts. Also reused for the email-CHANGE
  // flow (paired with pendingEmail below); there is no separate change token.
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  pendingEmail: varchar("pending_email", { length: 255 }), // For email change flow

  // Personal information
  fullName: varchar("full_name", { length: 100 }),
  firstName: varchar("first_name", { length: 50 }),
  lastName: varchar("last_name", { length: 50 }),
  displayName: varchar("display_name", { length: 100 }),
  birthday: date("birthday"),
  birthdayHideYear: boolean("birthday_hide_year").default(false),
  gender: varchar("gender", { length: 50 }),
  phoneNumber: text("phone_number"), // Legacy - use phone_number_mobile
  phoneNumberMobile: text("phone_number_mobile"), // Primary
  phoneNumberWork: text("phone_number_work"),
  phoneNumberHome: text("phone_number_home"),
  address: jsonb("address"), // { street, city, state, zip, country }
  occupation: varchar("occupation", { length: 100 }),
  occupationCustom: boolean("occupation_custom").default(false),
  company: varchar("company", { length: 255 }),

  // Display preferences
  timezone: varchar("timezone", { length: 50 }).default("UTC"),
  profilePictureUrl: text("profile_picture_url"),
  bannerUrl: text("banner_url"),

  // Rich profile fields
  bio: text("bio"),
  socialLinks: jsonb("social_links"), // { linkedin?, twitter?, github?, website? }
  nrc: varchar("nrc", { length: 20 }), // National Registration Card

  // Financial profile
  annualIncome: decimal("annual_income", { precision: 15, scale: 2 }),
  incomeFrequency: varchar("income_frequency", { length: 20 }), // monthly, bi-weekly, annual
  employmentStatus: varchar("employment_status", { length: 50 }), // employed, self-employed, retired
  investmentGoal: varchar("investment_goal", { length: 50 }), // conservative, moderate, aggressive
  riskTolerance: varchar("risk_tolerance", { length: 50 }), // low, medium, high
  salaryRangeEncrypted: text("salary_range_encrypted"), // Encrypted salary range

  // Profile metadata
  profileCompleteness: integer("profile_completeness").default(0),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),

  // Account lockout
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockedUntil: timestamp("locked_until"),
  lastFailedLoginAt: timestamp("last_failed_login_at"),

  // Email MFA
  mfaEnabled: boolean("mfa_enabled").default(false),
  mfaMethod: varchar("mfa_method", { length: 20 }), // 'email'
  mfaCode: text("mfa_code"), // Hashed MFA code
  mfaCodeExpiry: timestamp("mfa_code_expiry"),
  mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(),
  mfaBackupCodesGeneratedAt: timestamp("mfa_backup_codes_generated_at"), // SEC-06: For 90-day expiry
},
(table) => ({
  lockedUntilIdx: index("idx_users_locked_until")
    .on(table.lockedUntil)
    .where(sql`locked_until IS NOT NULL`),
  backupCodesExpiryIdx: index("idx_users_backup_codes_expiry")
    .on(table.mfaBackupCodesGeneratedAt)
    .where(sql`mfa_enabled = true AND mfa_backup_codes IS NOT NULL`),
}));

/**
 * Password History Table (P3-47)
 *
 * Stores previous password hashes to prevent reuse.
 * When a user changes their password, the old hash is stored here.
 * Password change validation checks against the last 5 passwords.
 */
export const passwordHistory = pgTable("password_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Password Reset Tokens Table (R1)
 *
 * Stores single-use, time-limited password reset tokens.
 * SECURITY: only the sha256 hex hash of the raw token is stored - the raw
 * token exists only in the reset email link and is never persisted or logged.
 * usedAt marks a token consumed (or invalidated by a newer request).
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    requestIp: text("request_ip"),
  },
  (table) => ({
    userIdx: index("idx_password_reset_tokens_user_id").on(table.userId),
    tokenHashIdx: uniqueIndex("idx_password_reset_tokens_token_hash").on(
      table.tokenHash,
    ),
    // Explicit FK name (<63 chars) so generated migrations stay stable
    // (Postgres truncates identifiers at 63 bytes - see CLAUDE.md).
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "password_reset_tokens_user_id_fk",
    }).onDelete("cascade"),
  }),
);

export const userDisplaySettings = pgTable("user_display_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme", { length: 20 }).default("system"), // 'light', 'dark', 'system'
  currency: varchar("currency", { length: 3 }).default("ZMW"), // ISO 4217
  locale: varchar("locale", { length: 10 }).default("en-US"), // Language (en-US, fr-FR, etc.)
  timezone: varchar("timezone", { length: 100 }).default("Africa/Lusaka"), // IANA timezone
  numberFormat: varchar("number_format", { length: 20 }).default("US"), // 'US', 'EU', 'IN'
  dateFormat: varchar("date_format", { length: 20 }).default("MM/DD/YYYY"),
  currencyPosition: varchar("currency_position", { length: 10 }).default(
    "before",
  ), // 'before' ($100) or 'after' (100$)
  firstDayOfWeek: varchar("first_day_of_week", { length: 10 }).default(
    "Sunday",
  ),
  viewMode: varchar("view_mode", { length: 20 }).default("comfortable"), // 'compact' or 'comfortable'
  dashboardWidgets: jsonb("dashboard_widgets"), // Customizable dashboard layout
  reportWidgetPreferences: jsonb("report_widget_preferences"), // Reports dashboard widget preferences
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  reportWidgetsIdx: index("idx_user_display_settings_report_widgets")
    .using("gin", table.reportWidgetPreferences),
}));

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    notificationType: varchar("notification_type", { length: 50 }).notNull(),
    inAppEnabled: boolean("in_app_enabled").default(true),
    emailEnabled: boolean("email_enabled").default(true),
    pushEnabled: boolean("push_enabled").default(false),
    thresholdAmount: decimal("threshold_amount", { precision: 15, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
);

export const userPushSubscriptions = pgTable("user_push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").notNull(), // { p256dh: string, auth: string }
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  userIdx: index("idx_user_push_subscriptions_user_id").on(table.userId),
  endpointIdx: index("idx_user_push_subscriptions_endpoint").on(
    table.endpoint,
  ),
}));

export const userQuietHours = pgTable("user_quiet_hours", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(false),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // Transaction entry defaults
  rememberLastAccount: boolean("remember_last_account").default(true),
  rememberLastCategoryPerMerchant: boolean(
    "remember_last_category_per_merchant",
  ).default(true),
  defaultTransactionType: varchar("default_transaction_type", {
    length: 20,
  }).default("expense"),
  autoFillTodayDate: boolean("auto_fill_today_date").default(true),

  // Import behavior
  skipDuplicateImports: boolean("skip_duplicate_imports").default(true),
  autoAssignCategoriesFromRules: boolean(
    "auto_assign_categories_from_rules",
  ).default(true),

  // Receipt handling
  autoCreateFromReceipt: boolean("auto_create_from_receipt").default(false),
  requireOcrReview: boolean("require_ocr_review").default(true),
  ocrConfidenceThreshold: integer("ocr_confidence_threshold").default(70),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userAIPreferences = pgTable("user_ai_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // AI feature toggles (placeholder for future)
  allowDataTraining: boolean("allow_data_training").default(true),
  aiInsightsEnabled: boolean("ai_insights_enabled").default(true),
  aiCategorySuggestions: boolean("ai_category_suggestions").default(true),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userTwoFactorAuth = pgTable("user_two_factor_auth", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(false),
  method: varchar("method", { length: 20 }), // 'app', 'sms', 'email'
  secret: text("secret"), // Encrypted TOTP secret
  backupCodes: text("backup_codes").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  deviceName: varchar("device_name", { length: 255 }),
  deviceType: varchar("device_type", { length: 50 }),
  browser: varchar("browser", { length: 100 }),
  os: varchar("os", { length: 100 }),
  ipAddress: inet("ip_address"),
  location: varchar("location", { length: 255 }),
  isTrusted: boolean("is_trusted").default(false),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userLoginHistory = pgTable("user_login_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  loginTime: timestamp("login_time").defaultNow(),
  deviceName: varchar("device_name", { length: 255 }),
  ipAddress: inet("ip_address"),
  location: varchar("location", { length: 255 }),
  success: boolean("success").notNull(),
  failureReason: text("failure_reason"),
});

// connect-pg-simple session table
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey().notNull(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "set null",
  }),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  actionUrl: varchar("action_url", { length: 255 }),
  metadata: jsonb("metadata"),
  dedupeKey: varchar("dedupe_key", { length: 150 }),
  isRead: boolean("is_read").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  userUnreadIdx: index("idx_notifications_user_unread").on(
    table.userId,
    table.isRead,
    table.createdAt.desc(),
  ),
  userCreatedIdx: index("idx_notifications_user_created").on(
    table.userId,
    table.createdAt.desc(),
  ),
  dedupeIdx: uniqueIndex("idx_notifications_dedupe")
    .on(table.userId, table.dedupeKey)
    .where(sql`dedupe_key IS NOT NULL`),
}));

// ============================================================================
// HOUSEHOLDS
// ============================================================================

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("ZMW"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").default(1),
  notificationRetentionDays: integer("notification_retention_days")
    .notNull()
    .default(90),
  // AI Assistant consent (Zambia DPA compliance)
  aiConsentGiven: boolean("ai_consent_given").default(false),
  aiConsentDate: timestamp("ai_consent_date"),
  aiConsentVersion: varchar("ai_consent_version", { length: 10 }).default(
    "v1.0",
  ),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  currencyLengthCheck: check(
    "chk_household_currency_length",
    sql`currency IS NULL OR LENGTH(currency) = 3`,
  ),
}));

export const householdMembers = pgTable("household_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  role: householdRoleEnum("role").notNull(), // owner, admin, member, view_only
  joinedAt: timestamp("joined_at").defaultNow(),
  lastActiveAt: timestamp("last_active_at"),
},
(table) => ({
  userIdx: index("idx_household_members_user").on(table.userId),
  householdIdx: index("idx_household_members_household").on(table.householdId),
  // A user may belong to a household at most once. Without this, addMember and
  // the accept-invite path can create duplicate membership rows, making role
  // resolution ambiguous (findMember/findByUserId use LIMIT 1).
  householdUserUnique: uniqueIndex("household_members_household_user_unique").on(
    table.householdId,
    table.userId,
  ),
}));

export const householdPreferences = pgTable("household_preferences", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  defaultMonthOnlyChanges: boolean("default_month_only_changes").default(true),
  autoRolloverBudget: boolean("auto_rollover_budget").default(false),
  rolloverPercentage: integer("rollover_percentage").default(100),
  autoMarkReviewed: boolean("auto_mark_reviewed").default(false),
  reviewThresholdAmount: decimal("review_threshold_amount", {
    precision: 15,
    scale: 2,
  }),
  budgetSystem: varchar("budget_system", { length: 20 }).default("flex"),
  showPendingTransactions: boolean("show_pending_transactions").default(true),
  allowEditPending: boolean("allow_edit_pending").default(true),
  displayMerchantLogos: boolean("display_merchant_logos").default(true),
  defaultBudgetScope: varchar("default_budget_scope", { length: 20 }).default(
    "current_month",
  ),
  // ISSUE-012: Configurable budget alert thresholds
  budgetWarningThreshold: integer("budget_warning_threshold").default(75),
  budgetDangerThreshold: integer("budget_danger_threshold").default(90),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const householdInvitations = pgTable("household_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: householdRoleEnum("role").notNull().default("member"),
  inviteCode: varchar("invite_code", { length: 64 }).notNull().unique(),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
},
(table) => ({
  codeIdx: index("idx_household_invitations_code").on(table.inviteCode),
  householdPendingIdx: index("idx_household_invitations_household_pending")
    .on(table.householdId, table.acceptedAt)
    .where(sql`accepted_at IS NULL`),
  emailIdx: index("idx_household_invitations_email")
    .on(table.email, table.householdId)
    .where(sql`accepted_at IS NULL`),
}));

// ============================================================================
// CATEGORIES
// ============================================================================

export const categoryGroups = pgTable("category_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'expenses', 'income', 'transfers'
  budgetMode: varchar("budget_mode", { length: 20 })
    .notNull()
    .default("by_category"), // by_category | by_group
  rolloverEnabled: boolean("rollover_enabled").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  displayOrder: integer("display_order").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  groupId: uuid("group_id").references(() => categoryGroups.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 100 }).notNull(),
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 7 }),
  includeInBudget: boolean("include_in_budget").default(true),
  rolloverEnabled: boolean("rollover_enabled").default(false),
  rolloverStartBalance: decimal("rollover_start_balance", {
    precision: 15,
    scale: 2,
  }),
  isArchived: boolean("is_archived").default(false),
  displayOrder: integer("display_order").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
},
(table) => ({
  groupIdx: index("idx_categories_group")
    .on(table.groupId, table.displayOrder)
    .where(sql`deleted_at IS NULL`),
}));

// ============================================================================
// MERCHANTS
// ============================================================================

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  logoUrl: text("logo_url"),
  category: varchar("category", { length: 100 }),
  defaultCategoryId: uuid("default_category_id").references(
    () => categories.id,
  ),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  iconType: varchar("icon_type", { length: 20 }).default("logo"),
  customIcon: text("custom_icon"),
  transactionCount: integer("transaction_count").default(0),
  lastTransactionDate: date("last_transaction_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  categoryIdx: index("idx_merchants_category").on(table.category),
  defaultCategoryIdx: index("idx_merchants_default_category").on(
    table.defaultCategoryId,
  ),
  householdActiveIdx: index("idx_merchants_household_active").on(
    table.householdId,
    table.isActive,
  ),
}));

export const merchantAliases = pgTable("merchant_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "cascade",
  }),
  aliasName: varchar("alias_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const merchantLogoUploads = pgTable("merchant_logo_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  storedFilename: varchar("stored_filename", { length: 255 }).notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, {
    onDelete: "set null",
  }),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
},
(table) => ({
  merchantIdx: index("idx_merchant_logo_uploads_merchant").on(
    table.merchantId,
  ),
}));

export const merchantMergeHistory = pgTable("merchant_merge_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceMerchantId: uuid("source_merchant_id").notNull(),
  sourceMerchantName: varchar("source_merchant_name", {
    length: 255,
  }).notNull(),
  targetMerchantId: uuid("target_merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  mergedTransactionIds: jsonb("merged_transaction_ids"),
  mergedBy: uuid("merged_by").references(() => users.id),
  mergedAt: timestamp("merged_at").defaultNow(),
  canUndo: boolean("can_undo").default(true),
  undoExpiresAt: timestamp("undo_expires_at").default(
    sql`(CURRENT_TIMESTAMP + INTERVAL '30 days')`,
  ),
},
(table) => ({
  targetIdx: index("idx_merchant_merge_history_target").on(
    table.targetMerchantId,
  ),
  canUndoIdx: index("idx_merchant_merge_history_can_undo").on(
    table.canUndo,
    table.undoExpiresAt,
  ),
}));

// ============================================================================
// TAGS
// ============================================================================

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }),
  icon: varchar("icon", { length: 50 }),
  memberSpecific: boolean("member_specific").default(false),
  memberId: uuid("member_id").references(() => users.id),
  usageCount: integer("usage_count").default(0),
  isArchived: boolean("is_archived").default(false), // FUNC-002: Proper archive support
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tag validation schemas
export const insertTagSchema = z.object({
  name: z
    .string()
    .min(1, "Tag name is required")
    .max(50, "Tag name must be 50 characters or less"),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format")
    .optional()
    .nullable(),
  icon: z.string().max(50).optional().nullable(),
  memberSpecific: z.boolean().optional().default(false),
  memberId: z.string().uuid().optional().nullable(),
});

export const updateTagSchema = insertTagSchema.partial();

export const selectTagSchema = createSelectSchema(tags);

export type InsertTag = z.infer<typeof insertTagSchema>;
export type Tag = typeof tags.$inferSelect;

// ============================================================================
// RULES ENGINE
// ============================================================================

export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  enabled: boolean("enabled").default(true),
  priority: integer("priority").notNull(),
  conditions: jsonb("conditions").notNull(),
  conditionLogic: varchar("condition_logic", { length: 10 })
    .notNull()
    .default("all"),
  actions: jsonb("actions").notNull(),
  splitConfig: jsonb("split_config"), // For split transaction rules
  applyToPast: boolean("apply_to_past").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const ruleExecutionLog = pgTable("rule_execution_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id").references(() => rules.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id"),
  executedAt: timestamp("executed_at").defaultNow(),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
});

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

export const dataExports = pgTable("data_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  exportType: varchar("export_type", { length: 50 }).notNull(),
  fileFormat: varchar("file_format", { length: 10 }).notNull(),
  fileUrl: text("file_url"),
  dateRangeStart: date("date_range_start"),
  dateRangeEnd: date("date_range_end"),
  recordCount: integer("record_count"),
  // FIX REPORTS-EXPORT-002: Store export parameters for reproducible downloads
  parameters: jsonb("parameters"), // Stores filters, includePending, scope, etc.
  status: varchar("status", { length: 20 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
},
(table) => ({
  householdIdx: index("idx_data_exports_household_id").on(table.householdId),
  userHouseholdIdx: index("idx_data_exports_user_household").on(
    table.userId,
    table.householdId,
  ),
}));

export const dataImports = pgTable("data_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: integer("file_size"),
  recordCount: integer("record_count"),
  successfulCount: integer("successful_count").default(0),
  failedCount: integer("failed_count").default(0),
  status: varchar("status", { length: 20 }).default("pending"),
  errorLog: text("error_log"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// ============================================================================
// FILTER PRESETS
// ============================================================================

/**
 * Filter Presets Table
 *
 * Stores user-saved filter combinations for quick access.
 * Supports multiple contexts (transactions, reports, etc.)
 */
export const filterPresets = pgTable("filter_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  context: varchar("context", { length: 50 }).notNull(), // 'transactions', 'reports', 'budget'
  filters: jsonb("filters").notNull(), // JSON object containing filter values
  isDefault: boolean("is_default").default(false),
  isShared: boolean("is_shared").default(false), // Whether visible to household
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  oneDefaultPerScope: uniqueIndex("filter_presets_one_default_per_scope")
    .on(table.householdId, table.userId, table.context)
    .where(sql`is_default = true`),
  uniqueNamePerScope: uniqueIndex("filter_presets_name_unique_per_scope").on(
    table.householdId,
    table.userId,
    table.context,
    table.name,
  ),
}));

export const insertFilterPresetSchema = createInsertSchema(filterPresets, {
  name: z.string().min(1, "Name is required").max(100),
  context: z.enum(["transactions", "reports", "budget", "cashflow"]),
  filters: z.record(z.unknown()),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const selectFilterPresetSchema = createSelectSchema(filterPresets);

export type FilterPreset = typeof filterPresets.$inferSelect;
export type InsertFilterPreset = z.infer<typeof insertFilterPresetSchema>;

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

// User schemas
export const insertUserSchema = createInsertSchema(users, {
  email: z.string().email(),
  username: z.string().min(3).max(255),
  fullName: z.string().min(1).max(100).optional(),
}).pick({
  username: true,
  email: true,
  passwordHash: true,
  fullName: true,
  birthday: true,
  timezone: true,
  emailVerified: true,
  emailVerificationToken: true,
  emailVerificationExpiry: true,
});

export const selectUserSchema = createSelectSchema(users);

// Display settings schemas
export const insertDisplaySettingsSchema =
  createInsertSchema(userDisplaySettings);
export const selectDisplaySettingsSchema =
  createSelectSchema(userDisplaySettings);

// Notification preferences schemas
export const insertNotificationPreferenceSchema = createInsertSchema(
  userNotificationPreferences,
);
export const selectNotificationPreferenceSchema = createSelectSchema(
  userNotificationPreferences,
);

// User preferences schemas
export const insertUserPreferencesSchema = createInsertSchema(userPreferences);
export const selectUserPreferencesSchema = createSelectSchema(userPreferences);

// User AI preferences schemas
export const insertUserAIPreferencesSchema =
  createInsertSchema(userAIPreferences);
export const selectUserAIPreferencesSchema =
  createSelectSchema(userAIPreferences);

// Household schemas
export const insertHouseholdSchema = createInsertSchema(households);
export const selectHouseholdSchema = createSelectSchema(households);

// Category schemas
export const insertCategoryGroupSchema = createInsertSchema(categoryGroups);
export const selectCategoryGroupSchema = createSelectSchema(categoryGroups);
export const insertCategorySchema = createInsertSchema(categories);
export const selectCategorySchema = createSelectSchema(categories);

// ============================================================================
// TYPES
// ============================================================================

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertDisplaySettings = z.infer<typeof insertDisplaySettingsSchema>;
export type DisplaySettings = typeof userDisplaySettings.$inferSelect;

export type InsertNotificationPreference = z.infer<
  typeof insertNotificationPreferenceSchema
>;
export type NotificationPreference =
  typeof userNotificationPreferences.$inferSelect;

export type UserPushSubscription = typeof userPushSubscriptions.$inferSelect;
export type InsertUserPushSubscription =
  typeof userPushSubscriptions.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type InsertHousehold = z.infer<typeof insertHouseholdSchema>;
export type Household = typeof households.$inferSelect;

export type HouseholdInvitation = typeof householdInvitations.$inferSelect;
export type InsertHouseholdInvitation =
  typeof householdInvitations.$inferInsert;

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

export type InsertCategoryGroup = z.infer<typeof insertCategoryGroupSchema>;
export type CategoryGroup = typeof categoryGroups.$inferSelect;

export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

export type InsertUserAIPreferences = z.infer<
  typeof insertUserAIPreferencesSchema
>;
export type UserAIPreferences = typeof userAIPreferences.$inferSelect;

// ============================================================================
// DASHBOARD & WIDGET PREFERENCES TYPES
// ============================================================================

/**
 * Configuration for an individual dashboard widget
 */
export interface DashboardWidgetConfig {
  id: string;
  label: string;
  enabled: boolean;
}

/**
 * Dashboard widgets storage structure
 */
export interface DashboardWidgetsPreferences {
  widgets: DashboardWidgetConfig[];
  version: number;
}

/**
 * Configuration for a report widget
 */
export interface ReportWidgetConfig {
  enabled: boolean;
  order: number;
  chartType: string;
}

/**
 * Custom chart configuration for reports
 */
export interface CustomChartConfig {
  id: string;
  name: string;
  chartType: string;
  primaryMetric: string;
  secondaryMetric?: string;
  groupBy?: string;
  aggregation?: string;
  order: number;
}

/**
 * Report widget preferences storage structure
 */
export interface ReportWidgetPreferences {
  coreWidgets: Record<string, ReportWidgetConfig>;
  optionalWidgets: Record<string, ReportWidgetConfig>;
  customCharts: CustomChartConfig[];
  hasCompletedWidgetSetup: boolean;
}

/**
 * Extended DisplaySettings with properly typed JSONB fields
 */
export interface DisplaySettingsWithPreferences extends DisplaySettings {
  dashboardWidgets: DashboardWidgetsPreferences | null;
  reportWidgetPreferences: ReportWidgetPreferences | null;
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  // Basic info
  name: varchar("name", { length: 255 }).notNull(),
  type: accountTypeEnum("type").notNull(), // checking, savings, etc
  subtype: varchar("subtype", { length: 50 }), // e.g., "brokerage", "401k", "roth_ira"
  institution: varchar("institution", { length: 255 }),
  institutionLogo: text("institution_logo"),

  // Balance tracking
  balance: decimal("balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  availableBalance: decimal("available_balance", { precision: 15, scale: 2 }),
  initialBalance: decimal("initial_balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  creditLimit: decimal("credit_limit", { precision: 15, scale: 2 }), // For credit accounts
  apr: decimal("apr", { precision: 5, scale: 2 }), // APR percentage for credit/loan accounts
  statementDay: integer("statement_day"), // Statement closing day (1-31) for credit accounts
  // Asset details (property/vehicle)
  estimatedValue: decimal("estimated_value", { precision: 15, scale: 2 }),
  purchaseDate: date("purchase_date"),
  address: text("address"),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  // Classification for net worth
  isAsset: boolean("is_asset").notNull().default(true), // false for credit cards, loans
  isPrivate: boolean("is_private").notNull().default(false), // visible only to owner
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }), // Owner for privacy
  isHidden: boolean("is_hidden").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  excludeFromNetWorth: boolean("exclude_from_net_worth")
    .notNull()
    .default(false), // Exclude from net worth calculations
  hideTransactions: boolean("hide_transactions").notNull().default(false), // Hide from cash flow and budget

  // Display
  color: varchar("color", { length: 7 }),
  icon: varchar("icon", { length: 50 }),
  displayOrder: integer("display_order").notNull().default(0),

  // External connections (for future bank sync integrations)
  externalId: varchar("external_id", { length: 255 }),
  externalSource: varchar("external_source", { length: 50 }), // e.g. "manual", "csv_import"
  lastSyncedAt: timestamp("last_synced_at"),

  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
},
(table) => ({
  householdIdx: index("idx_accounts_household")
    .on(table.householdId, table.displayOrder)
    .where(sql`deleted_at IS NULL AND is_archived = FALSE`),
  householdAssetIdx: index("idx_accounts_household_asset")
    .on(table.householdId, table.isAsset)
    .where(sql`deleted_at IS NULL AND is_hidden = FALSE`),
  typeHouseholdIdx: index("idx_accounts_type_household")
    .on(table.householdId, table.type)
    .where(sql`deleted_at IS NULL`),
  currencyLengthCheck: check(
    "chk_account_currency_length",
    sql`currency IS NULL OR LENGTH(currency) = 3`,
  ),
}));

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  // Ownership for "mine" vs "household" scope
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  // Core transaction data
  date: date("date").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }), // Pre-rule/cleanup name
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }), // ISO 4217 code, defaults to account/household currency
  type: transactionTypeEnum("type").notNull(), // income, expense, transfer, balance_adjustment

  // Categorization
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),

  // For transfers
  transferAccountId: uuid("transfer_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  transferTransactionId: uuid("transfer_transaction_id"), // Links the pair - intentionally no FK to avoid circular dependency issues during strict inserts, or add deferrable
  isTransferIn: boolean("is_transfer_in").default(false),

  // FX data for cross-currency transfers (stored on BOTH transfer rows)
  fxRate: decimal("fx_rate", { precision: 18, scale: 8 }), // Conversion rate used
  fxBaseCurrency: varchar("fx_base_currency", { length: 3 }), // Source currency (e.g., USD)
  fxQuoteCurrency: varchar("fx_quote_currency", { length: 3 }), // Target currency (e.g., ZMW)
  fxTimestamp: timestamp("fx_timestamp"), // When the rate was captured
  fxSource: varchar("fx_source", { length: 50 }), // Rate source (e.g., "manual", "api:xe.com")
  convertedAmount: decimal("converted_amount", { precision: 15, scale: 2 }), // Amount in household base currency

  // For balance adjustments
  isBalanceAdjustmentIncrease: boolean(
    "is_balance_adjustment_increase",
  ).default(true),

  // Status flags
  isPending: boolean("is_pending").notNull().default(false),
  status: transactionStatusEnum("status").default("cleared"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringTransactionId: uuid("recurring_transaction_id"),

  // Exclusion flags for analytics
  isExcludedFromReports: boolean("is_excluded_from_reports")
    .notNull()
    .default(false),
  isExcludedFromBudget: boolean("is_excluded_from_budget")
    .notNull()
    .default(false),

  // Privacy
  isPrivate: boolean("is_private").notNull().default(false),

  // Idempotency and Source
  idempotencyKey: uuid("idempotency_key").unique(),
  source: transactionSourceEnum("source").default("manual"),

  // Review workflow
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),

  // User notes
  notes: text("notes"),

  // External sync
  externalId: varchar("external_id", { length: 255 }),

  // Metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
},
(table) => ({
  householdDateIdx: index("idx_transactions_household_date")
    .on(table.householdId, table.date.desc())
    .where(sql`deleted_at IS NULL`),
  householdTypeDateIdx: index("idx_transactions_household_type_date")
    .on(table.householdId, table.type, table.date.desc())
    .where(sql`deleted_at IS NULL`),
  categoryDateIdx: index("idx_transactions_category_date")
    .on(table.categoryId, table.date.desc())
    .where(sql`deleted_at IS NULL AND is_excluded_from_reports = FALSE`),
  merchantDateIdx: index("idx_transactions_merchant_date")
    .on(table.merchantId, table.date.desc())
    .where(sql`deleted_at IS NULL`),
  accountDateIdx: index("idx_transactions_account_date")
    .on(table.accountId, table.date.desc())
    .where(sql`deleted_at IS NULL`),
  ownerDateIdx: index("idx_transactions_owner_date")
    .on(table.ownerUserId, table.date.desc())
    .where(sql`deleted_at IS NULL`),
  pendingIdx: index("idx_transactions_pending")
    .on(table.householdId, table.isPending)
    .where(sql`deleted_at IS NULL AND is_pending = TRUE`),
  cursorIdx: index("idx_transactions_cursor")
    .on(table.date.desc(), table.id.desc())
    .where(sql`deleted_at IS NULL`),
  currencyIdx: index("idx_transactions_currency").on(table.currency),
  accountTypeDateIdx: index("idx_transactions_account_type_date")
    .on(table.accountId, table.date)
    .where(sql`deleted_at IS NULL`),
  categoryMonthIdx: index("idx_transactions_category_month")
    .on(table.categoryId, table.date)
    .where(sql`deleted_at IS NULL AND type = 'expense'`),
  transferPairUniq: uniqueIndex("uniq_transactions_transfer_pair")
    .on(table.householdId, table.transferTransactionId, table.isTransferIn)
    .where(sql`deleted_at IS NULL AND type = 'transfer'`),
  amountNonzeroCheck: check(
    "chk_transaction_amount_nonzero",
    sql`type = 'balance_adjustment' OR ABS(CAST(amount AS DECIMAL)) > 0`,
  ),
  currencyLengthCheck: check(
    "chk_transaction_currency_length",
    sql`currency IS NULL OR LENGTH(currency) = 3`,
  ),
}));

// ============================================================================
// TRANSACTION ATTACHMENTS
// ============================================================================

export const transactionAttachments = pgTable("transaction_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),

  // File metadata
  filename: varchar("filename", { length: 255 }).notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  size: integer("size").notNull(),
  storagePath: varchar("storage_path", { length: 500 }).notNull(),
  thumbnailPath: varchar("thumbnail_path", { length: 500 }),

  // OCR metadata for receipt scanning
  ocrStatus: varchar("ocr_status", { length: 20 }).default("none"), // none, pending, processing, completed, failed
  ocrData: jsonb("ocr_data").$type<OcrExtractedData>(),
  ocrConfidence: decimal("ocr_confidence", { precision: 5, scale: 2 }), // 0.00 - 100.00
  ocrProcessedAt: timestamp("ocr_processed_at"),
  ocrErrorMessage: text("ocr_error_message"),

  // Upload tracking
  uploadedBy: uuid("uploaded_by").references(() => users.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  transactionIdx: index("idx_transaction_attachments_transaction_id").on(
    table.transactionId,
  ),
  createdAtIdx: index("idx_transaction_attachments_created_at").on(
    table.createdAt,
  ),
  ocrStatusIdx: index("transaction_attachments_ocr_status_idx")
    .on(table.ocrStatus)
    .where(sql`ocr_status != 'none'`),
}));

// ============================================================================
// TRANSACTION TAGS (Many-to-Many)
// ============================================================================

export const transactionTags = pgTable("transaction_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  transactionIdx: index("idx_transaction_tags_transaction").on(
    table.transactionId,
  ),
  tagIdx: index("idx_transaction_tags_tag").on(table.tagId),
  // SCP-335: a transaction may carry a given tag at most once. Without this
  // unique constraint, addTagToTransaction's onConflictDoNothing() never fires,
  // so re-tagging silently inserts duplicate links and inflates usageCount.
  uniqueTransactionTag: uniqueIndex("unique_transaction_tag").on(
    table.transactionId,
    table.tagId,
  ),
}));

// ============================================================================
// TRANSACTION SPLITS
// ============================================================================

export const transactionSplits = pgTable("transaction_splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),

  // Split details
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),

  // Order for display
  displayOrder: integer("display_order").notNull().default(0),

  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  transactionIdx: index("idx_transaction_splits_transaction").on(
    table.transactionId,
    table.displayOrder,
  ),
  categoryIdx: index("idx_transaction_splits_category").on(
    table.categoryId,
    table.transactionId,
  ),
}));

// ============================================================================
// NET WORTH SNAPSHOTS
// ============================================================================

export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  date: date("date").notNull(),

  // Aggregated values
  totalAssets: decimal("total_assets", { precision: 15, scale: 2 }).notNull(),
  totalLiabilities: decimal("total_liabilities", {
    precision: 15,
    scale: 2,
  }).notNull(),
  netWorth: decimal("net_worth", { precision: 15, scale: 2 }).notNull(),

  // Breakdown by account type (JSONB for flexibility)
  assetsByType: jsonb("assets_by_type"), // { checking: 5000, savings: 10000, ... }
  liabilitiesByType: jsonb("liabilities_by_type"), // { credit_card: 2000, loan: 5000, ... }

  // Individual account balances at snapshot time
  accountBalances: jsonb("account_balances"), // [{ accountId, balance }, ...]

  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  // Idempotency: snapshotWorker upserts with ON CONFLICT (household_id, date).
  // Postgres requires a matching unique index for that ON CONFLICT to work.
  uniqHouseholdDate: uniqueIndex("uniq_net_worth_snapshots_household_date").on(
    table.householdId,
    table.date,
  ),
  householdDateIdx: index("idx_net_worth_snapshots_household_date").on(
    table.householdId,
    table.date.desc(),
  ),
}));

// ============================================================================
// ACCOUNT BALANCE SNAPSHOTS
// ============================================================================

export const accountBalanceSnapshots = pgTable("account_balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  date: date("date").notNull(),
  balance: decimal("balance", { precision: 15, scale: 2 }).notNull(),
  availableBalance: decimal("available_balance", { precision: 15, scale: 2 }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  // Idempotency: snapshotWorker / AccountSnapshotRepository upsert with
  // ON CONFLICT (account_id, date); requires a matching unique index.
  uniqAccountDate: uniqueIndex("uniq_account_balance_snapshots_account_date").on(
    table.accountId,
    table.date,
  ),
  accountDateIdx: index("idx_account_balance_snapshots_account_date").on(
    table.accountId,
    table.date.desc(),
  ),
}));

// ============================================================================
// BUDGETS
// ============================================================================

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 255 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "cascade",
  }),
  categoryGroupId: uuid("category_group_id").references(
    () => categoryGroups.id,
    { onDelete: "cascade" },
  ),

  // Budget configuration
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  // Monthly-only until period-aware yearly/custom calculations are implemented.
  period: varchar("period", { length: 20 }).notNull().default("monthly"),

  // Rollover settings
  rolloverEnabled: boolean("rollover_enabled").notNull().default(false),
  rolloverAmount: decimal("rollover_amount", {
    precision: 15,
    scale: 2,
  }).default("0"),

  // Alert thresholds (percentage)
  warningThreshold: integer("warning_threshold").default(80),
  alertThreshold: integer("alert_threshold").default(100),

  isActive: boolean("is_active").notNull().default(true),
  isFlexBucket: boolean("is_flex_bucket").notNull().default(false),

  // Multi-currency support (DB-002)
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
},
(table) => ({
  householdActiveIdx: index("idx_budgets_household_active")
    .on(table.householdId)
    .where(sql`is_active = TRUE`),
  householdActiveStatusIdx: index("idx_budgets_household_active_status")
    .on(table.householdId, table.isActive)
    .where(sql`is_active = true`),
  categoryIdx: index("idx_budgets_category_id")
    .on(table.categoryId)
    .where(sql`category_id IS NOT NULL`),
  categoryGroupIdx: index("idx_budgets_category_group_id")
    .on(table.categoryGroupId)
    .where(sql`category_group_id IS NOT NULL`),
  flexBucketIdx: index("idx_budgets_flex_bucket")
    .on(table.householdId, table.isFlexBucket)
    .where(sql`is_flex_bucket = true`),
  flexUniqueIdx: uniqueIndex("idx_budgets_flex_unique")
    .on(table.householdId)
    .where(sql`is_flex_bucket = true`),
  amountPositiveCheck: check(
    "chk_budget_amount_positive",
    sql`CAST(amount AS DECIMAL) >= 0`,
  ),
  periodMonthlyCheck: check(
    "chk_budgets_period_monthly",
    sql`period = 'monthly'`,
  ),
  warningThresholdCheck: check(
    "chk_budget_warning_threshold",
    sql`warning_threshold IS NULL OR (warning_threshold >= 0 AND warning_threshold <= 100)`,
  ),
  alertThresholdCheck: check(
    "chk_budget_alert_threshold",
    sql`alert_threshold IS NULL OR (alert_threshold >= 0 AND alert_threshold <= 200)`,
  ),
}));

export const budgetPeriods = pgTable("budget_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),

  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),

  // Computed/cached values
  budgetAmount: decimal("budget_amount", { precision: 15, scale: 2 }).notNull(),
  spentAmount: decimal("spent_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  rolloverIn: decimal("rollover_in", { precision: 15, scale: 2 }).default("0"),

  // Multi-currency support (DB-003)
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  // ISSUE-009: Optimistic locking version for concurrency control
  version: integer("version").notNull().default(1),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
},
(table) => ({
  budgetDateIdx: index("idx_budget_periods_budget_date").on(
    table.budgetId,
    table.startDate,
    table.endDate,
  ),
  lookupIdx: index("idx_budget_periods_lookup").on(
    table.budgetId,
    table.startDate,
    table.endDate,
  ),
  budgetDateRangeIdx: index("idx_budget_periods_budget_date_range")
    .on(table.budgetId, table.startDate, table.endDate)
    .where(sql`budget_id IS NOT NULL`),
  budgetIdIdx: index("idx_budget_periods_budget_id").on(table.budgetId),
  coveringIdx: index("idx_budget_periods_covering").on(
    table.budgetId,
    table.startDate,
    table.endDate,
    table.budgetAmount,
    table.spentAmount,
    table.rolloverIn,
    table.version,
  ),
  // NOTE: legacy index used "INCLUDE (budget_id, budget_amount, spent_amount)";
  // drizzle-kit cannot express INCLUDE, so the covering columns are omitted.
  dateRangeIdx: index("idx_budget_periods_date_range").on(
    table.startDate,
    table.endDate,
  ),
  budgetPeriodUnique: uniqueIndex(
    "budget_periods_budget_id_start_date_end_date_unique",
  ).on(table.budgetId, table.startDate, table.endDate),
}));

// ============================================================================
// GOALS
// ============================================================================

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 7 }),
  customImageUrl: text("custom_image_url"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),

  // Target
  targetAmount: decimal("target_amount", { precision: 15, scale: 2 }).notNull(),
  currentAmount: decimal("current_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),
  priority: integer("priority").notNull().default(0),
  notes: text("notes"),

  // Timeline
  targetDate: date("target_date"),
  startDate: date("start_date").notNull().defaultNow(),
  projectedCompletionDate: date("projected_completion_date"),
  monthlyProjection: decimal("monthly_projection", { precision: 15, scale: 2 }),

  // Investment Goal specific
  expectedReturn: decimal("expected_return", { precision: 5, scale: 2 }), // Percentage (e.g. 12.5)
  inflationRate: decimal("inflation_rate", { precision: 5, scale: 2 }), // Percentage (e.g. 10.0)

  // Linked account (optional - for tracking)
  linkedAccountId: uuid("linked_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  progressSource: goalProgressSourceEnum("progress_source")
    .notNull()
    .default("contributions"),

  // Goal type
  type: goalTypeEnum("type").notNull().default("save_up"),
  goalType: varchar("goal_type", { length: 50 }),

  // Status
  status: goalStatusEnum("status").notNull().default("on_track"),
  spendingReducesProgress: boolean("spending_reduces_progress")
    .notNull()
    .default(false),

  // Pay down fields
  debtAccountId: uuid("debt_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  originalBalance: decimal("original_balance", { precision: 15, scale: 2 }),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }),
  minimumPayment: decimal("minimum_payment", { precision: 15, scale: 2 }),
  monthlyPayment: decimal("monthly_payment", { precision: 15, scale: 2 }),
  oneTimePayment: decimal("one_time_payment", { precision: 15, scale: 2 }),
  payoffMethod: payoffMethodEnum("payoff_method"),

  // Status
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
},
(table) => ({
  typeIdx: index("idx_goals_type").on(table.householdId, table.type),
  statusIdx: index("idx_goals_status").on(table.householdId, table.status),
  debtAccountIdx: index("idx_goals_debt_account")
    .on(table.debtAccountId)
    .where(sql`debt_account_id IS NOT NULL`),
  targetPositiveCheck: check(
    "chk_goal_target_positive",
    sql`CAST(target_amount AS DECIMAL) > 0`,
  ),
  currentNonnegativeCheck: check(
    "chk_goal_current_nonnegative",
    sql`CAST(current_amount AS DECIMAL) >= 0`,
  ),
}));

export const goalContributions = pgTable("goal_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),

  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  date: date("date").notNull(),
  notes: text("notes"),

  // Optional link to transaction
  transactionId: uuid("transaction_id").references(() => transactions.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  goalDateIdx: index("idx_goal_contributions_goal_date").on(
    table.goalId,
    table.date,
  ),
}));

export const goalAccountAssignments = pgTable(
  "goal_account_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    assignmentType: assignmentTypeEnum("assignment_type").notNull(),
    partialAmount: decimal("partial_amount", { precision: 15, scale: 2 }),
    autoUpdate: boolean("auto_update").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // FIX DATA-GOAL-004: Unique constraint to prevent duplicate assignments
    uniqueGoalAccount: uniqueIndex("unique_goal_account_idx").on(
      table.goalId,
      table.accountId,
    ),
    goalIdx: index("idx_goal_account_assignments_goal").on(table.goalId),
    accountIdx: index("idx_goal_account_assignments_account").on(
      table.accountId,
    ),
    fullBalanceUniqueIdx: uniqueIndex("uq_goal_account_full_balance")
      .on(table.accountId)
      .where(sql`assignment_type = 'full_balance'`),
    partialNoAutoCheck: check(
      "chk_partial_no_auto",
      sql`assignment_type = 'full_balance' OR auto_update = FALSE`,
    ),
  }),
);

export const goalTransfers = pgTable("goal_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  fromGoalId: uuid("from_goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  toGoalId: uuid("to_goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  householdIdx: index("idx_goal_transfers_household").on(table.householdId),
  fromIdx: index("idx_goal_transfers_from").on(table.fromGoalId),
  toIdx: index("idx_goal_transfers_to").on(table.toGoalId),
  dateIdx: index("idx_goal_transfers_date").on(table.createdAt),
  differentGoalsCheck: check(
    "chk_different_goals",
    sql`from_goal_id != to_goal_id`,
  ),
  positiveAmountCheck: check("chk_positive_amount", sql`amount > 0`),
}));

export const transactionGoalLinks = pgTable("transaction_goal_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  linkType: linkTypeEnum("link_type").notNull().default("contribution"),
  linkedAt: timestamp("linked_at").notNull().defaultNow(),
  linkedBy: uuid("linked_by").references(() => users.id, {
    onDelete: "set null",
  }),
},
(table) => ({
  transactionIdx: index("idx_transaction_goal_links_transaction").on(
    table.transactionId,
  ),
  goalIdx: index("idx_transaction_goal_links_goal").on(table.goalId),
  transactionGoalUnique: uniqueIndex("uq_transaction_goal").on(
    table.transactionId,
    table.goalId,
  ),
}));

export const goalActivityLog = pgTable("goal_activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  activityType: varchar("activity_type", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  previousBalance: decimal("previous_balance", { precision: 15, scale: 2 }),
  newBalance: decimal("new_balance", { precision: 15, scale: 2 }),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  goalIdx: index("idx_goal_activity_goal").on(table.goalId),
  dateIdx: index("idx_goal_activity_date").on(table.createdAt),
}));

export const goalImageUploads = pgTable("goal_image_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  storedFilename: varchar("stored_filename", { length: 255 }).notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, {
    onDelete: "set null",
  }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
},
(table) => ({
  householdIdx: index("idx_goal_image_uploads_household").on(
    table.householdId,
  ),
}));

// ============================================================================
// RECURRING TRANSACTIONS
// ============================================================================

export const recurringTransactions = pgTable("recurring_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  // Template data
  name: varchar("name", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  amountType: varchar("amount_type", { length: 10 }).default("fixed"),
  amountTolerance: integer("amount_tolerance").default(0),
  type: transactionTypeEnum("type").notNull(), // income, expense, transfer
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),

  // Schedule
  frequency: recurringFrequencyEnum("frequency").notNull(), // daily, weekly, biweekly, monthly, quarterly, yearly
  intervalValue: integer("interval_value").default(1),
  intervalUnit: varchar("interval_unit", { length: 10 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextDueDate: date("next_due_date").notNull(),

  // Day of month/week for scheduling
  dayOfMonth: integer("day_of_month"), // 1-31
  dayOfWeek: integer("day_of_week"), // 0-6 (Sunday = 0)

  // Tracking
  totalOccurrences: integer("total_occurrences").default(0),
  missedCount: integer("missed_count").default(0),
  lastOccurredDate: date("last_occurred_date"),

  // Detection metadata
  detectionMethod: varchar("detection_method", { length: 20 }).default(
    "manual",
  ),
  detectionConfidence: integer("detection_confidence"),

  // Notifications
  reminderDays: integer("reminder_days").default(3), // Days before to remind
  reminderEmail: boolean("reminder_email").default(false),
  reminderPush: boolean("reminder_push").default(false),
  reminderInApp: boolean("reminder_in_app").default(true),

  // Auto-linking behavior
  autoLinkEnabled: boolean("auto_link_enabled").default(true),
  autoMarkReviewed: boolean("auto_mark_reviewed").default(false),

  // Subscription tracking
  isSubscription: boolean("is_subscription").default(false),
  trialEndDate: date("trial_end_date"),

  isActive: boolean("is_active").notNull().default(true),
  isPaused: boolean("is_paused").notNull().default(false),

  notes: text("notes"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
},
(table) => ({
  amountPositiveCheck: check(
    "chk_recurring_amount_positive",
    sql`CAST(amount AS DECIMAL) > 0`,
  ),
}));

// ============================================================================
// RECURRING TRANSACTION LINKS
// ============================================================================

export const recurringTransactionLinks = pgTable(
  "recurring_transaction_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurringTransactionId: uuid("recurring_transaction_id")
      .notNull()
      .references(() => recurringTransactions.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),

    // Match metadata
    matchConfidence: integer("match_confidence"),
    matchMethod: varchar("match_method", { length: 20 }).default("manual"),
    expectedDate: date("expected_date"),
    actualDate: date("actual_date"),
    expectedAmount: decimal("expected_amount", { precision: 15, scale: 2 }),
    actualAmount: decimal("actual_amount", { precision: 15, scale: 2 }),

    // Status
    status: varchar("status", { length: 20 }).default("linked"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    transactionIdx: index("idx_recurring_links_transaction").on(
      table.transactionId,
    ),
    recurringIdx: index("idx_recurring_links_recurring").on(
      table.recurringTransactionId,
    ),
    // Legacy created an unnamed UNIQUE (transaction_id, recurring_transaction_id);
    // expressed here as a named unique index.
    transactionRecurringUnique: uniqueIndex(
      "uq_recurring_link_transaction_recurring",
    ).on(table.transactionId, table.recurringTransactionId),
  }),
);

// ============================================================================
// RECURRING TRANSACTION HISTORY
// ============================================================================

export const recurringTransactionHistory = pgTable(
  "recurring_transaction_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurringTransactionId: uuid("recurring_transaction_id")
      .notNull()
      .references(() => recurringTransactions.id, { onDelete: "cascade" }),

    // Change tracking
    action: varchar("action", { length: 30 }).notNull(),
    previousState: jsonb("previous_state"),
    newState: jsonb("new_state"),
    changeReason: text("change_reason"),

    // Context
    performedBy: uuid("performed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    linkedTransactionId: uuid("linked_transaction_id").references(
      () => transactions.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    recurringIdx: index("idx_recurring_history_recurring").on(
      table.recurringTransactionId,
    ),
    createdIdx: index("idx_recurring_history_created").on(
      table.recurringTransactionId,
      table.createdAt.desc(),
    ),
  }),
);

// ============================================================================
// AUDIT LOGS
// ============================================================================

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }), // Who performed action
  action: varchar("action", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id"),
  details: jsonb("details"), // Before/after state or error details
  ipAddress: inet("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(table) => ({
  householdCreatedIdx: index("idx_audit_logs_household_created").on(
    table.householdId,
    table.createdAt.desc(),
  ),
  entityIdx: index("idx_audit_logs_entity").on(
    table.entityType,
    table.entityId,
  ),
}));

// ============================================================================
// TRANSACTION COMMENTS
// ============================================================================

export const transactionComments = pgTable("transaction_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================================================
// PENDING RECEIPTS (For Receipt Scanning)
// ============================================================================

// Type definition for OCR extracted data
export interface OcrExtractedData {
  merchantName?: string;
  amount?: string;
  date?: string; // ISO format
  subtotal?: string;
  tax?: string;
  tip?: string;
  lineItems?: OcrLineItem[];
  rawText?: string;
  currency?: string;
  paymentMethod?: string;
}

export interface OcrLineItem {
  description: string;
  amount: string;
  quantity?: number;
  suggestedCategoryId?: string;
}

// Standalone receipts that haven't been matched to transactions yet
export const pendingReceipts = pgTable("pending_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),

  // File info
  filename: varchar("filename", { length: 255 }).notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  size: integer("size").notNull(),
  storagePath: varchar("storage_path", { length: 500 }).notNull(),
  thumbnailPath: varchar("thumbnail_path", { length: 500 }),

  // OCR data
  ocrStatus: varchar("ocr_status", { length: 20 }).default("pending").notNull(),
  ocrData: jsonb("ocr_data").$type<OcrExtractedData>(),
  ocrConfidence: decimal("ocr_confidence", { precision: 5, scale: 2 }),
  ocrProcessedAt: timestamp("ocr_processed_at"),
  ocrErrorMessage: text("ocr_error_message"),

  // Matching
  matchStatus: varchar("match_status", { length: 20 })
    .default("pending")
    .notNull(), // pending, matched, manual, no_match
  matchedTransactionId: uuid("matched_transaction_id").references(
    () => transactions.id,
  ),
  matchAttempts: integer("match_attempts").default(0).notNull(),
  lastMatchAttempt: timestamp("last_match_attempt"),
  nextMatchAt: timestamp("next_match_at"),

  // Idempotency & Deduplication
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
  imageHash: varchar("image_hash", { length: 64 }), // SHA-256 hash for duplicate detection

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
},
(table) => ({
  householdIdx: index("pending_receipts_household_idx").on(table.householdId),
  matchStatusIdx: index("pending_receipts_match_status_idx").on(
    table.matchStatus,
    table.nextMatchAt,
  ),
  idempotencyIdx: index("pending_receipts_idempotency_idx")
    .on(table.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL`),
  imageHashIdx: index("pending_receipts_image_hash_idx")
    .on(table.householdId, table.imageHash)
    .where(sql`image_hash IS NOT NULL`),
}));

// Zod validators for receipt scanning
export const ocrExtractedDataSchema = z.object({
  merchantName: z.string().max(255).optional(),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  subtotal: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  tax: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  tip: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string().max(500),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        quantity: z.number().positive().optional(),
        suggestedCategoryId: z.string().uuid().optional(),
      }),
    )
    .optional(),
  rawText: z.string().max(10000).optional(),
  currency: z.string().length(3).optional(),
  paymentMethod: z.string().max(50).optional(),
});

export const uploadReceiptSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
});

export const applyReceiptDataSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().max(255),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        amount: z.string(),
        categoryId: z.string().uuid().optional(),
      }),
    )
    .optional(),
});

export const matchReceiptSchema = z.object({
  transactionId: z.string().uuid(),
});

// ============================================================================
// ADDITIONAL ZOD SCHEMAS
// ============================================================================

// Account schemas
export const insertAccountSchema = createInsertSchema(accounts);
export const selectAccountSchema = createSelectSchema(accounts);

// Transaction schemas
export const insertTransactionSchema = createInsertSchema(transactions);
export const selectTransactionSchema = createSelectSchema(transactions);

// Budget schemas
export const insertBudgetSchema = createInsertSchema(budgets);
export const selectBudgetSchema = createSelectSchema(budgets);

// Goal schemas
export const insertGoalSchema = createInsertSchema(goals);
export const selectGoalSchema = createSelectSchema(goals);
export const insertGoalAccountAssignmentSchema = createInsertSchema(
  goalAccountAssignments,
);
export const selectGoalAccountAssignmentSchema = createSelectSchema(
  goalAccountAssignments,
);
export const insertGoalTransferSchema = createInsertSchema(goalTransfers);
export const selectGoalTransferSchema = createSelectSchema(goalTransfers);
export const insertTransactionGoalLinkSchema =
  createInsertSchema(transactionGoalLinks);
export const selectTransactionGoalLinkSchema =
  createSelectSchema(transactionGoalLinks);
export const insertGoalActivityLogSchema = createInsertSchema(goalActivityLog);
export const selectGoalActivityLogSchema = createSelectSchema(goalActivityLog);
export const insertGoalImageUploadSchema = createInsertSchema(goalImageUploads);
export const selectGoalImageUploadSchema = createSelectSchema(goalImageUploads);

// Recurring transaction schemas
export const insertRecurringTransactionSchema = createInsertSchema(
  recurringTransactions,
);
export const selectRecurringTransactionSchema = createSelectSchema(
  recurringTransactions,
);
export const insertRecurringTransactionLinkSchema = createInsertSchema(
  recurringTransactionLinks,
);
export const selectRecurringTransactionLinkSchema = createSelectSchema(
  recurringTransactionLinks,
);
export const insertRecurringTransactionHistorySchema = createInsertSchema(
  recurringTransactionHistory,
);
export const selectRecurringTransactionHistorySchema = createSelectSchema(
  recurringTransactionHistory,
);

// ============================================================================
// ADDITIONAL TYPES
// ============================================================================

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goals.$inferSelect;
export type InsertGoalAccountAssignment = z.infer<
  typeof insertGoalAccountAssignmentSchema
>;
export type GoalAccountAssignment = typeof goalAccountAssignments.$inferSelect;
export type InsertGoalTransfer = z.infer<typeof insertGoalTransferSchema>;
export type GoalTransfer = typeof goalTransfers.$inferSelect;
export type InsertTransactionGoalLink = z.infer<
  typeof insertTransactionGoalLinkSchema
>;
export type TransactionGoalLink = typeof transactionGoalLinks.$inferSelect;
export type InsertGoalActivityLog = z.infer<typeof insertGoalActivityLogSchema>;
export type GoalActivityLog = typeof goalActivityLog.$inferSelect;
export type InsertGoalImageUpload = z.infer<typeof insertGoalImageUploadSchema>;
export type GoalImageUpload = typeof goalImageUploads.$inferSelect;

export type InsertRecurringTransaction = z.infer<
  typeof insertRecurringTransactionSchema
>;
export type RecurringTransaction = typeof recurringTransactions.$inferSelect;
export type InsertRecurringTransactionLink = z.infer<
  typeof insertRecurringTransactionLinkSchema
>;
export type RecurringTransactionLink =
  typeof recurringTransactionLinks.$inferSelect;
export type InsertRecurringTransactionHistory = z.infer<
  typeof insertRecurringTransactionHistorySchema
>;
export type RecurringTransactionHistory =
  typeof recurringTransactionHistory.$inferSelect;

export type TransactionTag = typeof transactionTags.$inferSelect;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type NetWorthSnapshot = typeof netWorthSnapshots.$inferSelect;
export type AccountBalanceSnapshot =
  typeof accountBalanceSnapshots.$inferSelect;
export type BudgetPeriod = typeof budgetPeriods.$inferSelect;
export type GoalContribution = typeof goalContributions.$inferSelect;
export type TransactionAttachment = typeof transactionAttachments.$inferSelect;
export type PendingReceipt = typeof pendingReceipts.$inferSelect;

// Notification schemas and types
export const insertNotificationSchema = createInsertSchema(notifications);
export const selectNotificationSchema = createSelectSchema(notifications);

export type InsertNotification = typeof notifications.$inferInsert;
export type Notification = typeof notifications.$inferSelect;

// ============================================================================
// INVESTMENT - SECURITIES
// ============================================================================

export const securities = pgTable("securities", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Identification
  symbol: varchar("symbol", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: securityTypeEnum("type").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),
  exchange: securityExchangeEnum("exchange"),

  // Classification
  isOffshore: boolean("is_offshore").default(false),
  sector: varchar("sector", { length: 100 }),
  cusipIsin: varchar("cusip_isin", { length: 20 }),

  // Pricing
  currentPrice: decimal("current_price", { precision: 15, scale: 4 }),
  lastPriceUpdate: timestamp("last_price_update"),

  // Tax
  withholdingTaxRate: decimal("withholding_tax_rate", {
    precision: 5,
    scale: 2,
  }).default("15.00"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// INVESTMENT - HOLDINGS
// ============================================================================

export const holdings = pgTable("holdings", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  securityId: uuid("security_id")
    .notNull()
    .references(() => securities.id, { onDelete: "cascade" }),

  // Position
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),

  // Cost basis tracking
  costBasis: decimal("cost_basis", { precision: 15, scale: 2 }),
  costBasisZmw: decimal("cost_basis_zmw", { precision: 15, scale: 2 }),
  acquiredDate: date("acquired_date"),
  acquisitionFxRate: decimal("acquisition_fx_rate", {
    precision: 10,
    scale: 4,
  }),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  householdIdx: index("idx_holdings_household").on(table.householdId),
  accountIdx: index("idx_holdings_account")
    .on(table.accountId)
    .where(sql`account_id IS NOT NULL`),
}));

// ============================================================================
// INVESTMENT - SECURITY PRICES (Historical)
// ============================================================================

export const securityPrices = pgTable("security_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  securityId: uuid("security_id")
    .notNull()
    .references(() => securities.id, { onDelete: "cascade" }),

  date: date("date").notNull(),
  price: decimal("price", { precision: 15, scale: 4 }).notNull(),
  source: varchar("source", { length: 50 }), // 'manual', 'yahoo_finance', 'boz'

  createdAt: timestamp("created_at").defaultNow(),
},
(table) => ({
  securityDateIdx: index("idx_security_prices_security_date").on(
    table.securityId,
    table.date.desc(),
  ),
  securityDateUnique: uniqueIndex("uniq_security_prices_security_date").on(
    table.securityId,
    table.date,
  ),
}));

// ============================================================================
// INVESTMENT - TRANSACTIONS
// ============================================================================

export const investmentTransactions = pgTable("investment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  holdingId: uuid("holding_id").references(() => holdings.id, {
    onDelete: "set null",
  }),
  securityId: uuid("security_id").references(() => securities.id, {
    onDelete: "set null",
  }),

  // Transaction details
  type: investmentTransactionTypeEnum("type").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }),
  price: decimal("price", { precision: 15, scale: 4 }),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  // FX conversion
  fxRate: decimal("fx_rate", { precision: 10, scale: 4 }),
  amountZmw: decimal("amount_zmw", { precision: 15, scale: 2 }),

  // Costs
  fees: decimal("fees", { precision: 15, scale: 2 }).default("0"),
  withholdingTax: decimal("withholding_tax", {
    precision: 15,
    scale: 2,
  }).default("0"),

  // Linking to main transactions table
  linkedTransactionId: uuid("linked_transaction_id").references(
    () => transactions.id,
    { onDelete: "set null" },
  ),

  transactionDate: date("transaction_date").notNull(),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
},
(table) => ({
  householdDateIdx: index("idx_investment_transactions_household_date").on(
    table.householdId,
    table.transactionDate.desc(),
  ),
  holdingIdx: index("idx_investment_transactions_holding")
    .on(table.holdingId, table.transactionDate.desc())
    .where(sql`holding_id IS NOT NULL`),
}));

// ============================================================================
// INVESTMENT - PRICE ALERTS
// ============================================================================

export const priceAlerts = pgTable("price_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  securityId: uuid("security_id")
    .notNull()
    .references(() => securities.id, { onDelete: "cascade" }),
  alertType: varchar("alert_type", { length: 20 }).notNull(), // above, below, change_pct
  threshold: decimal("threshold", { precision: 15, scale: 4 }).notNull(),
  isActive: boolean("is_active").default(true),
  lastTriggered: timestamp("last_triggered"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// INVESTMENT - TAX LOTS
// ============================================================================

export const taxLots = pgTable("tax_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  holdingId: uuid("holding_id")
    .notNull()
    .references(() => holdings.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(
    () => investmentTransactions.id,
    { onDelete: "set null" },
  ),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  costBasis: decimal("cost_basis", { precision: 15, scale: 2 }).notNull(),
  costBasisZmw: decimal("cost_basis_zmw", { precision: 15, scale: 2 }),
  acquiredDate: date("acquired_date").notNull(),
  acquisitionFxRate: decimal("acquisition_fx_rate", {
    precision: 10,
    scale: 4,
  }),
  remainingQuantity: decimal("remaining_quantity", {
    precision: 18,
    scale: 8,
  }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  holdingIdx: index("idx_tax_lots_holding").on(table.holdingId),
}));

export const taxLotDisposals = pgTable("tax_lot_disposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  holdingId: uuid("holding_id")
    .notNull()
    .references(() => holdings.id, { onDelete: "cascade" }),
  taxLotId: uuid("tax_lot_id")
    .notNull()
    .references(() => taxLots.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => investmentTransactions.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  proceeds: decimal("proceeds", { precision: 15, scale: 2 }).notNull(),
  proceedsZmw: decimal("proceeds_zmw", { precision: 15, scale: 2 }),
  costBasis: decimal("cost_basis", { precision: 15, scale: 2 }).notNull(),
  costBasisZmw: decimal("cost_basis_zmw", { precision: 15, scale: 2 }),
  realizedGain: decimal("realized_gain", { precision: 15, scale: 2 }).notNull(),
  realizedGainZmw: decimal("realized_gain_zmw", {
    precision: 15,
    scale: 2,
  }),
  disposedDate: date("disposed_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// INVESTMENT - FX RATES
// ============================================================================

export const fxRates = pgTable("fx_rates", {
  id: uuid("id").primaryKey().defaultRandom(),

  fromCurrency: varchar("from_currency", { length: 3 }).notNull(),
  toCurrency: varchar("to_currency", { length: 3 }).notNull(),
  rate: decimal("rate", { precision: 10, scale: 4 }).notNull(),
  date: date("date").notNull(),
  source: varchar("source", { length: 50 }).notNull(), // 'boz', 'xe.com', 'manual'

  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// INVESTMENT - CURRENCY ACCOUNTS
// ============================================================================

export const currencyAccounts = pgTable("currency_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  currency: varchar("currency", { length: 3 }).notNull(),
  openingBalance: decimal("opening_balance", {
    precision: 15,
    scale: 2,
  }).default("0"),
  currentBalance: decimal("current_balance", {
    precision: 15,
    scale: 2,
  }).default("0"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// INVESTMENT - PORTFOLIO BENCHMARKS
// ============================================================================

export const portfolioBenchmarks = pgTable("portfolio_benchmarks", {
  id: uuid("id").primaryKey().defaultRandom(),

  code: varchar("code", { length: 50 }).notNull(), // 'LUSE_ASI', 'BOZ_TBILL_91D', 'INFLATION_ZMW'
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  currency: varchar("currency", { length: 3 }),
  isActive: boolean("is_active").default(true),

  createdAt: timestamp("created_at").defaultNow(),
});

export const benchmarkValues = pgTable("benchmark_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  benchmarkId: uuid("benchmark_id")
    .notNull()
    .references(() => portfolioBenchmarks.id, { onDelete: "cascade" }),

  date: date("date").notNull(),
  value: decimal("value", { precision: 15, scale: 4 }).notNull(),
  source: varchar("source", { length: 50 }),

  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// INVESTMENT - ZOD SCHEMAS
// ============================================================================

export const insertSecuritySchema = createInsertSchema(securities, {
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(255),
});
export const selectSecuritySchema = createSelectSchema(securities);

export const insertHoldingSchema = createInsertSchema(holdings);
export const selectHoldingSchema = createSelectSchema(holdings);

export const insertSecurityPriceSchema = createInsertSchema(securityPrices);
export const selectSecurityPriceSchema = createSelectSchema(securityPrices);

export const insertInvestmentTransactionSchema = createInsertSchema(
  investmentTransactions,
);
export const selectInvestmentTransactionSchema = createSelectSchema(
  investmentTransactions,
);

export const insertTaxLotSchema = createInsertSchema(taxLots);
export const selectTaxLotSchema = createSelectSchema(taxLots);

export const insertTaxLotDisposalSchema = createInsertSchema(taxLotDisposals);
export const selectTaxLotDisposalSchema = createSelectSchema(taxLotDisposals);

export const insertFxRateSchema = createInsertSchema(fxRates);
export const selectFxRateSchema = createSelectSchema(fxRates);

// ============================================================================
// INVESTMENT - TYPES
// ============================================================================

export type InsertSecurity = z.infer<typeof insertSecuritySchema>;
export type Security = typeof securities.$inferSelect;

export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type Holding = typeof holdings.$inferSelect;

export type InsertSecurityPrice = z.infer<typeof insertSecurityPriceSchema>;
export type SecurityPrice = typeof securityPrices.$inferSelect;

export type InsertInvestmentTransaction = z.infer<
  typeof insertInvestmentTransactionSchema
>;
export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;

export type InsertTaxLot = z.infer<typeof insertTaxLotSchema>;
export type TaxLot = typeof taxLots.$inferSelect;

export type InsertTaxLotDisposal = z.infer<typeof insertTaxLotDisposalSchema>;
export type TaxLotDisposal = typeof taxLotDisposals.$inferSelect;

export type InsertFxRate = z.infer<typeof insertFxRateSchema>;
export type FxRate = typeof fxRates.$inferSelect;

export type CurrencyAccount = typeof currencyAccounts.$inferSelect;
export type PortfolioBenchmark = typeof portfolioBenchmarks.$inferSelect;
export type BenchmarkValue = typeof benchmarkValues.$inferSelect;

// ============================================================================
// GRZ GOVERNMENT SECURITIES TABLES
// ============================================================================

export const csdAccounts = pgTable("csd_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  csdAccountNumber: varchar("csd_account_number", { length: 50 }).notNull(),
  accountHolderName: varchar("account_holder_name", { length: 255 }),
  settlementBank: varchar("settlement_bank", { length: 100 }),
  settlementAccount: varchar("settlement_account", { length: 50 }),
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// FIX DATA-GRZ-001: GRZ auction results are PUBLIC market data (not per-household)
// Removed householdId - data is global and read-only for users, admin-writable
export const grzAuctionResults = pgTable(
  "grz_auction_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auctionDate: date("auction_date").notNull(),
    securityType: varchar("security_type", { length: 20 }).notNull(),
    tenor: varchar("tenor", { length: 20 }).notNull(),
    amountOffered: decimal("amount_offered", { precision: 15, scale: 2 }),
    amountAccepted: decimal("amount_accepted", { precision: 15, scale: 2 }),
    weightedAvgYield: decimal("weighted_avg_yield", { precision: 6, scale: 4 }),
    highestYield: decimal("highest_yield", { precision: 6, scale: 4 }),
    lowestYield: decimal("lowest_yield", { precision: 6, scale: 4 }),
    weightedAvgDiscount: decimal("weighted_avg_discount", {
      precision: 6,
      scale: 4,
    }),
    source: varchar("source", { length: 50 }).default("BOZ"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => {
    return {
      uniqueAuction: uniqueIndex("unique_auction_result_idx").on(
        table.auctionDate,
        table.securityType,
        table.tenor,
      ),
    };
  },
);

export const grzBonds = pgTable("grz_bonds", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .references(() => households.id)
    .notNull(),
  accountId: uuid("account_id").references(() => accounts.id),
  isin: varchar("isin", { length: 20 }),
  bondName: varchar("bond_name", { length: 100 }).notNull(),
  tenorYears: integer("tenor_years").notNull(),
  faceValue: decimal("face_value", { precision: 15, scale: 2 }).notNull(),
  purchasePrice: decimal("purchase_price", {
    precision: 15,
    scale: 2,
  }).notNull(),
  purchaseDate: date("purchase_date").notNull(),
  purchaseYield: decimal("purchase_yield", { precision: 6, scale: 4 }),
  acquisitionType: varchar("acquisition_type", { length: 20 }).default(
    "PRIMARY",
  ),
  couponRate: decimal("coupon_rate", { precision: 6, scale: 4 }).notNull(),
  couponFrequency: integer("coupon_frequency").default(2),
  firstCouponDate: date("first_coupon_date"),
  maturityDate: date("maturity_date").notNull(),
  csdAccountNumber: varchar("csd_account_number", { length: 50 }),
  csdReference: varchar("csd_reference", { length: 50 }),
  status: grzSecurityStatusEnum("status").default("active"),
  soldDate: date("sold_date"),
  soldPrice: decimal("sold_price", { precision: 15, scale: 2 }),
  soldYield: decimal("sold_yield", { precision: 6, scale: 4 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  householdIdx: index("idx_grz_bonds_household").on(table.householdId),
}));

export const grzBondPayments = pgTable("grz_bond_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  bondId: uuid("bond_id")
    .references(() => grzBonds.id)
    .notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentType: varchar("payment_type", { length: 20 }).notNull(),
  grossAmount: decimal("gross_amount", { precision: 15, scale: 2 }).notNull(),
  withholdingTax: decimal("withholding_tax", {
    precision: 15,
    scale: 2,
  }).default("0"),
  netAmount: decimal("net_amount", { precision: 15, scale: 2 }).notNull(),
  status: grzBondPaymentStatusEnum("status").default("scheduled"),
  actualPaymentDate: date("actual_payment_date"),
  investmentTransactionId: uuid("investment_transaction_id").references(
    () => investmentTransactions.id,
  ),
  incomeTransactionId: uuid("income_transaction_id").references(
    () => transactions.id,
  ),
  createdAt: timestamp("created_at").defaultNow(),
});

export const grzTBills = pgTable("grz_tbills", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .references(() => households.id)
    .notNull(),
  accountId: uuid("account_id").references(() => accounts.id),
  isin: varchar("isin", { length: 20 }),
  tbillName: varchar("tbill_name", { length: 100 }).notNull(),
  tenorDays: integer("tenor_days").notNull(),
  faceValue: decimal("face_value", { precision: 15, scale: 2 }).notNull(),
  purchasePrice: decimal("purchase_price", {
    precision: 15,
    scale: 2,
  }).notNull(),
  purchaseDate: date("purchase_date").notNull(),
  purchaseYield: decimal("purchase_yield", { precision: 6, scale: 4 }),
  discountAmount: decimal("discount_amount", { precision: 15, scale: 2 }),
  maturityDate: date("maturity_date").notNull(),
  csdAccountNumber: varchar("csd_account_number", { length: 50 }),
  status: grzSecurityStatusEnum("status").default("active"),
  maturedDate: date("matured_date"),
  rolloverToId: uuid("rollover_to_id"),
  maturityInvestmentTxId: uuid("maturity_investment_tx_id").references(
    () => investmentTransactions.id,
  ),
  maturityIncomeTxId: uuid("maturity_income_tx_id").references(
    () => transactions.id,
  ),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => ({
  householdIdx: index("idx_grz_tbills_household").on(table.householdId),
}));

// Zod Schemas
export const insertCsdAccountSchema = createInsertSchema(csdAccounts);
export const selectCsdAccountSchema = createSelectSchema(csdAccounts);
export const insertGrzAuctionResultSchema =
  createInsertSchema(grzAuctionResults);
export const selectGrzAuctionResultSchema =
  createSelectSchema(grzAuctionResults);
export const insertGrzBondSchema = createInsertSchema(grzBonds);
export const selectGrzBondSchema = createSelectSchema(grzBonds);
export const insertGrzBondPaymentSchema = createInsertSchema(grzBondPayments);
export const selectGrzBondPaymentSchema = createSelectSchema(grzBondPayments);
export const insertGrzTBillSchema = createInsertSchema(grzTBills);
export const selectGrzTBillSchema = createSelectSchema(grzTBills);

// Types
export type CsdAccount = z.infer<typeof selectCsdAccountSchema>;
export type InsertCsdAccount = z.infer<typeof insertCsdAccountSchema>;
export type GrzAuctionResult = z.infer<typeof selectGrzAuctionResultSchema>;
export type InsertGrzAuctionResult = z.infer<
  typeof insertGrzAuctionResultSchema
>;
export type GrzBond = z.infer<typeof selectGrzBondSchema>;
export type InsertGrzBond = z.infer<typeof insertGrzBondSchema>;
export type GrzBondPayment = z.infer<typeof selectGrzBondPaymentSchema>;
export type InsertGrzBondPayment = z.infer<typeof insertGrzBondPaymentSchema>;
export type GrzTBill = z.infer<typeof selectGrzTBillSchema>;
export type InsertGrzTBill = z.infer<typeof insertGrzTBillSchema>;

export const grzBondRelations = relations(grzBonds, ({ many }) => ({
  payments: many(grzBondPayments),
}));

export const grzBondPaymentRelations = relations(
  grzBondPayments,
  ({ one }) => ({
    bond: one(grzBonds, {
      fields: [grzBondPayments.bondId],
      references: [grzBonds.id],
    }),
  }),
);

// ============================================================================
// INVESTMENT - RELATIONS
// ============================================================================

export const holdingsRelations = relations(holdings, ({ one, many }) => ({
  security: one(securities, {
    fields: [holdings.securityId],
    references: [securities.id],
  }),
  household: one(households, {
    fields: [holdings.householdId],
    references: [households.id],
  }),
  account: one(accounts, {
    fields: [holdings.accountId],
    references: [accounts.id],
  }),
  taxLots: many(taxLots),
}));

export const securitiesRelations = relations(securities, ({ many }) => ({
  holdings: many(holdings),
  securityPrices: many(securityPrices),
}));

export const taxLotsRelations = relations(taxLots, ({ one }) => ({
  holding: one(holdings, {
    fields: [taxLots.holdingId],
    references: [holdings.id],
  }),
  household: one(households, {
    fields: [taxLots.householdId],
    references: [households.id],
  }),
}));

export const securityPricesRelations = relations(securityPrices, ({ one }) => ({
  security: one(securities, {
    fields: [securityPrices.securityId],
    references: [securities.id],
  }),
}));

// ============================================================================
// PENSION TABLES
// ============================================================================

export const pensionHoldings = pgTable("pension_holdings", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),

  providerName: varchar("provider_name", { length: 255 }).notNull(), // 'NAPSA', 'Prudential', etc.
  accountNumber: varchar("account_number", { length: 100 }),
  pensionType: varchar("pension_type", { length: 50 }).notNull(), // 'social_security', 'private', 'employer'
  currentBalance: decimal("current_balance", {
    precision: 15,
    scale: 2,
  }).default("0"),
  projectedRetirementDate: date("projected_retirement_date"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const pensionContributions = pgTable("pension_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  pensionHoldingId: uuid("pension_holding_id")
    .notNull()
    .references(() => pensionHoldings.id, { onDelete: "cascade" }),

  date: date("date").notNull(),
  employeeContribution: decimal("employee_contribution", {
    precision: 15,
    scale: 2,
  }).notNull(),
  employerContribution: decimal("employer_contribution", {
    precision: 15,
    scale: 2,
  }).notNull(),
  totalContribution: decimal("total_contribution", {
    precision: 15,
    scale: 2,
  }).notNull(),

  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// RECURRING INVESTMENTS
// ============================================================================

export const recurringInvestments = pgTable("recurring_investments", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  securityId: uuid("security_id").references(() => securities.id, {
    onDelete: "set null",
  }),

  type: varchar("type", { length: 50 }).notNull(), // 'sip', 'rollover'
  frequency: recurringFrequencyEnum("frequency").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),
  nextExecutionDate: date("next_execution_date").notNull(),
  isActive: boolean("is_active").default(true).notNull(),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const recurringExecutionLog = pgTable("recurring_execution_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  recurringInvestmentId: uuid("recurring_investment_id")
    .notNull()
    .references(() => recurringInvestments.id, { onDelete: "cascade" }),

  status: varchar("status", { length: 20 }).notNull(), // 'success', 'failed'
  executionDate: timestamp("execution_date").defaultNow().notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  resultEntityId: uuid("result_entity_id"), // Linked holding or transaction ID
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// PENSION & RECURRING - ZOD SCHEMAS
// ============================================================================

export const insertPensionHoldingSchema = createInsertSchema(pensionHoldings);
export const selectPensionHoldingSchema = createSelectSchema(pensionHoldings);
export const insertPensionContributionSchema =
  createInsertSchema(pensionContributions);
export const selectPensionContributionSchema =
  createSelectSchema(pensionContributions);
export const insertRecurringInvestmentSchema =
  createInsertSchema(recurringInvestments);
export const selectRecurringInvestmentSchema =
  createSelectSchema(recurringInvestments);

// ============================================================================
// PENSION & RECURRING - TYPES
// ============================================================================

export type PensionHolding = typeof pensionHoldings.$inferSelect;
export type InsertPensionHolding = z.infer<typeof insertPensionHoldingSchema>;
export type PensionContribution = typeof pensionContributions.$inferSelect;
export type InsertPensionContribution = z.infer<
  typeof insertPensionContributionSchema
>;
export type RecurringInvestment = typeof recurringInvestments.$inferSelect;
export type InsertRecurringInvestment = z.infer<
  typeof insertRecurringInvestmentSchema
>;
export type RecurringExecutionLog = typeof recurringExecutionLog.$inferSelect;

// ============================================================================
// OUTBOX EVENTS - Event-Driven Architecture
// ============================================================================

export const outboxEventStatusEnum = pgEnum("outbox_event_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_letter",
]);

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 100 }).notNull(), // e.g., "transaction.created"
  aggregateType: varchar("aggregate_type", { length: 50 }).notNull(), // e.g., "transaction"
  aggregateId: uuid("aggregate_id").notNull(), // ID of the entity
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  payload: jsonb("payload").notNull(), // Event data
  status: outboxEventStatusEnum("status").default("pending").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(5).notNull(),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Indexes for efficient polling
// CREATE INDEX idx_outbox_pending ON outbox_events(status, next_retry_at) WHERE status IN ('pending', 'failed');

// ============================================================================
// OUTBOX EVENTS - ZOD SCHEMAS
// ============================================================================

export const insertOutboxEventSchema = createInsertSchema(outboxEvents);
export const selectOutboxEventSchema = createSelectSchema(outboxEvents);

// ============================================================================
// OUTBOX EVENTS - TYPES
// ============================================================================

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type InsertOutboxEvent = z.infer<typeof insertOutboxEventSchema>;
export type OutboxEventStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "dead_letter";

// ============================================================================
// BACKGROUND JOBS
// ============================================================================

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(), // e.g., "daily_snapshots"
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  status: jobStatusEnum("status").default("pending").notNull(),
  priority: integer("priority").default(0).notNull(), // Higher = more urgent
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  lastError: text("last_error"),
  runAt: timestamp("run_at").defaultNow().notNull(), // Scheduled run time
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  idempotencyKey: varchar("idempotency_key", { length: 255 }), // For idempotent jobs
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// BACKGROUND JOBS - ZOD
// ============================================================================

export const insertJobSchema = createInsertSchema(jobs);
export const selectJobSchema = createSelectSchema(jobs);

// ============================================================================
// BACKGROUND JOBS - TYPES
// ============================================================================

export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type HouseholdPreferences = typeof householdPreferences.$inferSelect;

// ============================================================================
// AI ASSISTANT - CONVERSATION HISTORY (SCP-338)
// ============================================================================

/**
 * AI conversation thread.
 *
 * Scoped to a household AND the user who started it (Rule 11): a user must not
 * be able to read another household's — or another member's — conversations.
 * The chat flow creates one of these on the first message and reuses its id on
 * subsequent requests so chat history persists across requests.
 */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Short, human-readable label derived from the first user message. No PII
    // beyond what the user already typed; truncated by the service.
    title: varchar("title", { length: 200 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Lists are always scoped to (household, user) and ordered by recency.
    householdUserUpdatedIdx: index("idx_ai_conversations_hh_user_updated").on(
      table.householdId,
      table.userId,
      table.updatedAt.desc(),
    ),
  }),
);

/**
 * A single message within an AI conversation. Stores both the user's message
 * and the assistant's reply (one row each), so a conversation can be replayed.
 */
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    // Tool names used to produce an assistant reply (empty for user messages).
    toolsUsed: text("tools_used").array(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // Messages are always fetched by conversation, oldest first.
    conversationCreatedIdx: index("idx_ai_messages_conversation_created").on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export type AiConversation = typeof aiConversations.$inferSelect;
export type InsertAiConversation = typeof aiConversations.$inferInsert;
export type AiMessage = typeof aiMessages.$inferSelect;
export type InsertAiMessage = typeof aiMessages.$inferInsert;
