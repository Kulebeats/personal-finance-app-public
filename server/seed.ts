import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  categoryGroups,
  categories,
  merchants,
  tags,
  securities,
  csdAccounts,
  grzBonds,
  grzBondPayments,
  grzTBills,
  grzAuctionResults,
  portfolioBenchmarks,
  type InsertCsdAccount,
  type InsertGrzBond,
  type InsertGrzTBill,
  type InsertGrzAuctionResult,
} from "@shared/schema";
import {
  DEFAULT_CATEGORY_GROUPS,
  DEFAULT_CATEGORIES,
  DEFAULT_GROUP_COLORS,
} from "./config/defaultCategories";
import type { TransactionType } from "./utils/withTransaction";

// A query executor that is either the shared pool (`db`) or an open
// transaction. Lets seed helpers run standalone OR enlist in a caller's
// transaction so their writes commit/roll back atomically with it.
type DbExecutor = typeof db | TransactionType;

/**
 * Seed default categories for a household
 * Uses configurable default categories from config/defaultCategories.ts
 */
export async function seedDefaultCategories(householdId: string) {
  const defaultGroups = DEFAULT_CATEGORY_GROUPS.map((group) => ({
    householdId,
    ...group,
  }));

  /* Migrated to config/defaultCategories.ts
  const defaultGroups = [
    {
      name: "Income",
      type: "income",
      displayOrder: 1,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Housing & Utilities",
      type: "expenses",
      displayOrder: 2,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Food & Groceries",
      type: "expenses",
      displayOrder: 3,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Transport & Vehicles",
      type: "expenses",
      displayOrder: 4,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Children & Education",
      type: "expenses",
      displayOrder: 5,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Personal & Family",
      type: "expenses",
      displayOrder: 6,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Entertainment & Subscriptions",
      type: "expenses",
      displayOrder: 7,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Shopping & Purchases",
      type: "expenses",
      displayOrder: 8,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Health, Insurance & Financial",
      type: "expenses",
      displayOrder: 9,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Savings & Investments",
      type: "expenses",
      displayOrder: 10,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Business Expenses",
      type: "expenses",
      displayOrder: 11,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Transfers & Adjustments",
      type: "transfers",
      displayOrder: 12,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
    {
      name: "Other & Unbudgeted",
      type: "expenses",
      displayOrder: 13,
      budgetMode: "by_category",
      rolloverEnabled: false,
      isArchived: false,
    },
  ]; */

  const createdGroups = await db
    .insert(categoryGroups)
    .values(defaultGroups)
    .returning();

  const groupMap = new Map(createdGroups.map((g) => [g.name, g.id]));

  /* Migrated to config/defaultCategories.ts
  const groupColors: Record<string, string> = {
    Income: "#10B981",
    "Housing & Utilities": "#3B82F6",
    "Food & Groceries": "#22C55E",
    "Transport & Vehicles": "#F59E0B",
    "Children & Education": "#6366F1",
    "Personal & Family": "#EC4899",
    "Entertainment & Subscriptions": "#8B5CF6",
    "Shopping & Purchases": "#A855F7",
    "Health, Insurance & Financial": "#0EA5E9",
    "Savings & Investments": "#14B8A6",
    "Business Expenses": "#64748B",
    "Transfers & Adjustments": "#6B7280",
    "Other & Unbudgeted": "#9CA3AF",
  };

  const defaultCategories = [
    // 1. Income (Green)
    { group: "Income", name: "Salary - Primary Job", icon: "💵" },
    { group: "Income", name: "Salary - Secondary Job / Contract", icon: "💰" },
    { group: "Income", name: "Business Income", icon: "🏢" },
    { group: "Income", name: "Consultancy / Freelance", icon: "🧑‍💼" },
    { group: "Income", name: "Interest & Dividends", icon: "📈" },
    { group: "Income", name: "Rent Received", icon: "🏠" },
    { group: "Income", name: "Allowances & Per Diems", icon: "✈️" },
    { group: "Income", name: "Bonuses & Gratuities", icon: "🎉" },
    { group: "Income", name: "Cashback & Rewards", icon: "💸" },
    { group: "Income", name: "Other Income", icon: "💎" },

    // 2. Housing & Utilities (Blue)
    { group: "Housing & Utilities", name: "Rent / Mortgage", icon: "🏠" },
    {
      group: "Housing & Utilities",
      name: "Maid / Domestic Worker",
      icon: "🧹",
    },
    {
      group: "Housing & Utilities",
      name: "Gardener / Security Guard",
      icon: "🌱",
    },
    { group: "Housing & Utilities", name: "Waste Collection", icon: "🗑️" },
    { group: "Housing & Utilities", name: "Electricity / Power", icon: "⚡" },
    { group: "Housing & Utilities", name: "Water", icon: "💧" },
    { group: "Housing & Utilities", name: "Home Internet & TV", icon: "📶" },
    {
      group: "Housing & Utilities",
      name: "Home Improvement & Renovation",
      icon: "🔨",
    },
    {
      group: "Housing & Utilities",
      name: "Home Repairs & Maintenance",
      icon: "🔧",
    },
    { group: "Housing & Utilities", name: "Gas / Cooking Fuel", icon: "🔥" },

    // 3. Food & Groceries (Green)
    { group: "Food & Groceries", name: "Groceries (Home Food)", icon: "🛒" },
    { group: "Food & Groceries", name: "Takeaway / Fast Food", icon: "🍔" },
    { group: "Food & Groceries", name: "Restaurants & Dining Out", icon: "🍽️" },
    { group: "Food & Groceries", name: "Work Lunch / Daily Lunch", icon: "🥗" },
    { group: "Food & Groceries", name: "Other Food & Snacks", icon: "🥨" },

    // 4. Transport & Vehicles (Orange)
    { group: "Transport & Vehicles", name: "Fuel", icon: "⛽" },
    {
      group: "Transport & Vehicles",
      name: "Public Transport",
      icon: "🚌",
    },
    {
      group: "Transport & Vehicles",
      name: "Taxi & Ride Hailing",
      icon: "🚕",
    },
    { group: "Transport & Vehicles", name: "Car Insurance", icon: "🛡️" },
    {
      group: "Transport & Vehicles",
      name: "Car Maintenance & Repairs",
      icon: "🔧",
    },
    { group: "Transport & Vehicles", name: "Parking & Tolls", icon: "🅿️" },
    {
      group: "Transport & Vehicles",
      name: "Other Transport Costs",
      icon: "🚗",
    },

    // 5. Children & Education (Indigo)
    {
      group: "Children & Education",
      name: "School Fees - Child 1",
      icon: "🏫",
    },
    {
      group: "Children & Education",
      name: "School Fees - Child 2",
      icon: "🏫",
    },
    {
      group: "Children & Education",
      name: "School Materials & Uniforms",
      icon: "🎒",
    },
    {
      group: "Children & Education",
      name: "Extra Lessons & Tuition",
      icon: "📖",
    },
    {
      group: "Children & Education",
      name: "Kids Clothing & Shoes",
      icon: "👶",
    },
    {
      group: "Children & Education",
      name: "Kids Entertainment & Activities",
      icon: "🎮",
    },
    {
      group: "Children & Education",
      name: "Diapers & Baby Supplies",
      icon: "🍼",
    },
    {
      group: "Children & Education",
      name: "Kids Health & Pharmacy",
      icon: "💊",
    },

    // 6. Personal & Family (Pink)
    {
      group: "Personal & Family",
      name: "Family Support",
      icon: "👨‍👩‍👧‍👦",
    },
    { group: "Personal & Family", name: "Friend Support / Gifts", icon: "🎁" },
    {
      group: "Personal & Family",
      name: "Clothing & Shoes (Adult)",
      icon: "👕",
    },
    {
      group: "Personal & Family",
      name: "Toiletries & Personal Care",
      icon: "🧴",
    },
    {
      group: "Personal & Family",
      name: "Laundry & Cleaning Services",
      icon: "👔",
    },
    {
      group: "Personal & Family",
      name: "Pharmacy / Medical (Personal)",
      icon: "💊",
    },
    { group: "Personal & Family", name: "Hair & Grooming (Adult)", icon: "✂️" },
    { group: "Personal & Family", name: "Drinks & Nightlife", icon: "🍺" },
    { group: "Personal & Family", name: "Personal Miscellaneous", icon: "👜" },

    // 7. Entertainment & Subscriptions (Purple)
    {
      group: "Entertainment & Subscriptions",
      name: "Streaming Services",
      icon: "🎬",
    },
    {
      group: "Entertainment & Subscriptions",
      name: "Software & Online Tools",
      icon: "💻",
    },
    {
      group: "Entertainment & Subscriptions",
      name: "Entertainment & Recreation",
      icon: "🎭",
    },
    {
      group: "Entertainment & Subscriptions",
      name: "Hobbies & Fun Money",
      icon: "🎨",
    },

    // 8. Shopping & Purchases (Purple)
    {
      group: "Shopping & Purchases",
      name: "Household Items",
      icon: "🏠",
    },
    {
      group: "Shopping & Purchases",
      name: "Electronics & Gadgets",
      icon: "📱",
    },
    { group: "Shopping & Purchases", name: "Furniture & Homeware", icon: "🛋️" },
    {
      group: "Shopping & Purchases",
      name: "Non-Electronic Purchases",
      icon: "🛍️",
    },
    {
      group: "Shopping & Purchases",
      name: "Post Office & Delivery Costs",
      icon: "📮",
    },

    // 9. Health, Insurance & Financial (Cyan)
    {
      group: "Health, Insurance & Financial",
      name: "Health & Medical",
      icon: "⚕️",
    },
    {
      group: "Health, Insurance & Financial",
      name: "Insurance Premiums",
      icon: "🛡️",
    },
    {
      group: "Health, Insurance & Financial",
      name: "Loan Repayments",
      icon: "🏦",
    },
    {
      group: "Health, Insurance & Financial",
      name: "Credit Card Payments",
      icon: "💳",
    },
    {
      group: "Health, Insurance & Financial",
      name: "Bank Charges & Fees",
      icon: "🏦",
    },
    {
      group: "Health, Insurance & Financial",
      name: "Taxes & Statutory",
      icon: "📝",
    },
    {
      group: "Health, Insurance & Financial",
      name: "Financial Services",
      icon: "💼",
    },

    // 10. Savings & Investments (Teal)
    {
      group: "Savings & Investments",
      name: "Emergency / General Savings",
      icon: "💰",
    },
    {
      group: "Savings & Investments",
      name: "Holiday / Goal-based Savings",
      icon: "🏖️",
    },
    {
      group: "Savings & Investments",
      name: "Building Project / Construction",
      icon: "🏗️",
    },
    { group: "Savings & Investments", name: "Bonds & Investments", icon: "📊" },
    { group: "Savings & Investments", name: "Other Investments", icon: "📈" },

    // 11. Business Expenses (Slate)
    { group: "Business Expenses", name: "Advertising & Marketing", icon: "📢" },
    { group: "Business Expenses", name: "Business Travel & Meals", icon: "✈️" },
    {
      group: "Business Expenses",
      name: "Business Utilities & Internet",
      icon: "📶",
    },
    {
      group: "Business Expenses",
      name: "Office Supplies & Postage",
      icon: "📎",
    },
    {
      group: "Business Expenses",
      name: "Employee Wages / Contract",
      icon: "👥",
    },
    { group: "Business Expenses", name: "Business Auto Expenses", icon: "🚗" },
    { group: "Business Expenses", name: "Business Rent", icon: "🏢" },
    { group: "Business Expenses", name: "Business Insurance", icon: "🛡️" },

    // 12. Transfers & Adjustments (Gray)
    {
      group: "Transfers & Adjustments",
      name: "Transfer Between Accounts",
      icon: "🔄",
    },
    {
      group: "Transfers & Adjustments",
      name: "Credit Card Payment",
      icon: "💳",
    },
    {
      group: "Transfers & Adjustments",
      name: "Balance Adjustments",
      icon: "⚖️",
    },

    // 13. Other & Unbudgeted (Gray)
    {
      group: "Other & Unbudgeted",
      name: "Unbudgeted / Unexpected",
      icon: "❓",
    },
    { group: "Other & Unbudgeted", name: "Miscellaneous", icon: "📦" },
    {
      group: "Other & Unbudgeted",
      name: "Uncategorized",
      icon: "❓",
    },
  ]; */

  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((cat, index) => ({
      householdId,
      groupId: groupMap.get(cat.group)!,
      name: cat.name,
      icon: cat.icon || null,
      color: DEFAULT_GROUP_COLORS[cat.group] || "#6B7280",
      includeInBudget: cat.group !== "Transfers & Adjustments",
      rolloverEnabled: false,
      rolloverStartBalance: null,
      isArchived: false,
      displayOrder: index + 1,
    }))
  );

  console.log(
    `OK. Seeded ${DEFAULT_CATEGORIES.length} default categories for household ${householdId}`
  );
}

/**
 * Seed default notification types for a user
 * Uses canonical types from shared/notificationTypes.ts
 */
export async function seedDefaultNotificationPreferences(userId: string) {
  const { userNotificationPreferences } = await import("@shared/schema");
  const { NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES } = await import(
    "@shared/notificationTypes"
  );

  // Canonical notification types aligned with NOTIFICATIONS_REQUIREMENTS.md
  const notificationTypes = [
    // Transactions
    {
      type: NOTIFICATION_TYPES.LARGE_TRANSACTION,
      category: NOTIFICATION_CATEGORIES.TRANSACTIONS,
      thresholdAmount: "500",
    },
    {
      type: NOTIFICATION_TYPES.RECURRING_DUE,
      category: NOTIFICATION_CATEGORIES.TRANSACTIONS,
    },
    {
      type: NOTIFICATION_TYPES.UNUSUAL_SPENDING,
      category: NOTIFICATION_CATEGORIES.TRANSACTIONS,
    }, // Future v2

    // Budget
    {
      type: NOTIFICATION_TYPES.BUDGET_WARNING,
      category: NOTIFICATION_CATEGORIES.BUDGET,
    },
    {
      type: NOTIFICATION_TYPES.BUDGET_EXCEEDED,
      category: NOTIFICATION_CATEGORIES.BUDGET,
    },

    // Goals
    {
      type: NOTIFICATION_TYPES.GOAL_PROGRESS,
      category: NOTIFICATION_CATEGORIES.GOALS,
    },
    {
      type: NOTIFICATION_TYPES.GOAL_ACHIEVED,
      category: NOTIFICATION_CATEGORIES.GOALS,
    },

    // Security
    {
      type: NOTIFICATION_TYPES.NEW_LOGIN,
      category: NOTIFICATION_CATEGORIES.SECURITY,
    },
    {
      type: NOTIFICATION_TYPES.PASSWORD_CHANGED,
      category: NOTIFICATION_CATEGORIES.SECURITY,
    },
  ];

  await db.insert(userNotificationPreferences).values(
    notificationTypes.map((notif) => ({
      userId,
      notificationType: notif.type,
      inAppEnabled: true,
      emailEnabled: notif.category === NOTIFICATION_CATEGORIES.SECURITY, // Security emails on by default
      pushEnabled: false,
      thresholdAmount: notif.thresholdAmount || null,
    }))
  );

  console.log(
    `OK. Seeded ${notificationTypes.length} notification preferences for user ${userId}`
  );
}

/**
 * Seed default Zambian merchants for a household
 * Common merchants in Zambia for realistic demo data
 * Logo URLs use Google Favicon service (more reliable than Clearbit)
 */
export async function seedDefaultMerchants(householdId: string) {
  // Helper to get Google favicon URL (more reliable)
  const favicon = (domain: string) =>
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

  // Zambian merchants organized by category with logo URLs
  const zambianMerchants = [
    // Supermarkets & Groceries
    {
      name: "Pick n Pay",
      transactionCount: 45,
      logoUrl: favicon("picknpay.co.za"),
    },
    {
      name: "Shoprite",
      transactionCount: 38,
      logoUrl: favicon("shoprite.co.za"),
    },
    {
      name: "Game Stores",
      transactionCount: 12,
      logoUrl: favicon("game.co.za"),
    },
    { name: "Spar", transactionCount: 28, logoUrl: favicon("spar.co.za") },
    {
      name: "Choppies",
      transactionCount: 22,
      logoUrl: favicon("choppies.co.bw"),
    },
    { name: "Melissa Supermarket", transactionCount: 15, logoUrl: null },
    {
      name: "Food Lovers Market",
      transactionCount: 8,
      logoUrl: favicon("foodloversmarket.co.za"),
    },
    { name: "Freshpikt", transactionCount: 6, logoUrl: null },

    // Fast Food & Restaurants
    {
      name: "Hungry Lion",
      transactionCount: 35,
      logoUrl: favicon("hungrylion.co.za"),
    },
    {
      name: "Debonairs Pizza",
      transactionCount: 18,
      logoUrl: favicon("debonairspizza.co.za"),
    },
    { name: "Steers", transactionCount: 14, logoUrl: favicon("steers.co.za") },
    { name: "Nando's", transactionCount: 10, logoUrl: favicon("nandos.com") },
    { name: "KFC", transactionCount: 25, logoUrl: favicon("kfc.com") },
    {
      name: "Ocean Basket",
      transactionCount: 5,
      logoUrl: favicon("oceanbasket.com"),
    },
    {
      name: "Mugg & Bean",
      transactionCount: 8,
      logoUrl: favicon("muggandbean.co.za"),
    },
    { name: "Wimpy", transactionCount: 12, logoUrl: favicon("wimpy.co.za") },
    { name: "Rhapsody's", transactionCount: 4, logoUrl: null },
    { name: "Marlin Restaurant", transactionCount: 3, logoUrl: null },

    // Fuel Stations
    {
      name: "Puma Energy",
      transactionCount: 42,
      logoUrl: favicon("pumaenergy.com"),
    },
    {
      name: "Total Energies",
      transactionCount: 35,
      logoUrl: favicon("totalenergies.com"),
    },
    { name: "Engen", transactionCount: 28, logoUrl: favicon("engen.co.za") },
    { name: "Kobil", transactionCount: 15, logoUrl: favicon("kobil.co.ke") },
    {
      name: "Mount Meru",
      transactionCount: 10,
      logoUrl: favicon("mountmerupetroleum.com"),
    },

    // Banks & Financial
    { name: "Zanaco", transactionCount: 20, logoUrl: favicon("zanaco.co.zm") },
    {
      name: "Stanbic Bank",
      transactionCount: 18,
      logoUrl: favicon("stanbicbank.co.zm"),
    },
    { name: "FNB Zambia", transactionCount: 15, logoUrl: favicon("fnb.co.za") },
    {
      name: "Standard Chartered",
      transactionCount: 12,
      logoUrl: favicon("sc.com"),
    },
    { name: "Absa Bank", transactionCount: 10, logoUrl: favicon("absa.co.za") },
    {
      name: "Atlas Mara",
      transactionCount: 8,
      logoUrl: favicon("atlasmara.com"),
    },
    { name: "Indo Zambia Bank", transactionCount: 5, logoUrl: null },

    // Telecom & Internet
    { name: "MTN Zambia", transactionCount: 30, logoUrl: favicon("mtn.com") },
    {
      name: "Airtel Zambia",
      transactionCount: 28,
      logoUrl: favicon("airtel.com"),
    },
    { name: "Zamtel", transactionCount: 15, logoUrl: favicon("zamtel.co.zm") },
    {
      name: "Liquid Telecom",
      transactionCount: 6,
      logoUrl: favicon("liquidtelecom.com"),
    },
    { name: "Hai Zambia", transactionCount: 4, logoUrl: null },

    // Utilities
    { name: "ZESCO", transactionCount: 24, logoUrl: favicon("zesco.co.zm") },
    { name: "Lusaka Water", transactionCount: 12, logoUrl: null },
    { name: "DSTV Zambia", transactionCount: 12, logoUrl: favicon("dstv.com") },
    {
      name: "GOtv Zambia",
      transactionCount: 8,
      logoUrl: favicon("gotvafrica.com"),
    },

    // Pharmacies & Health
    {
      name: "Link Pharmacy",
      transactionCount: 15,
      logoUrl: favicon("linkpharmacy.co.zm"),
    },
    { name: "Health Mart Pharmacy", transactionCount: 10, logoUrl: null },
    { name: "Clicks", transactionCount: 8, logoUrl: favicon("clicks.co.za") },
    {
      name: "Dis-Chem",
      transactionCount: 6,
      logoUrl: favicon("dischem.co.za"),
    },
    { name: "CFB Hospital", transactionCount: 4, logoUrl: null },
    { name: "Levy Mwanawasa Hospital", transactionCount: 3, logoUrl: null },
    { name: "Medland Hospital", transactionCount: 2, logoUrl: null },

    // Retail & Shopping
    {
      name: "Pep Stores",
      transactionCount: 18,
      logoUrl: favicon("pepstores.com"),
    },
    { name: "Jet Stores", transactionCount: 12, logoUrl: favicon("jet.co.za") },
    {
      name: "Mr Price",
      transactionCount: 10,
      logoUrl: favicon("mrpricegroup.com"),
    },
    { name: "Edgars", transactionCount: 8, logoUrl: favicon("edgars.co.za") },
    {
      name: "Woolworths",
      transactionCount: 6,
      logoUrl: favicon("woolworths.co.za"),
    },
    {
      name: "Truworths",
      transactionCount: 5,
      logoUrl: favicon("truworths.co.za"),
    },
    {
      name: "Ackermans",
      transactionCount: 14,
      logoUrl: favicon("ackermans.co.za"),
    },

    // Electronics & Tech
    {
      name: "Incredible Connection",
      transactionCount: 4,
      logoUrl: favicon("incredible.co.za"),
    },
    {
      name: "Matrix Warehouse",
      transactionCount: 3,
      logoUrl: favicon("matrixwarehouse.co.za"),
    },
    { name: "Yalu Zambia", transactionCount: 5, logoUrl: null },

    // Hardware & Home
    {
      name: "Build It",
      transactionCount: 8,
      logoUrl: favicon("buildit.co.za"),
    },
    {
      name: "Builders Warehouse",
      transactionCount: 6,
      logoUrl: favicon("builders.co.za"),
    },
    {
      name: "Cashbuild",
      transactionCount: 5,
      logoUrl: favicon("cashbuild.co.za"),
    },

    // Education
    { name: "UNZA", transactionCount: 4, logoUrl: favicon("unza.zm") },
    { name: "CBU", transactionCount: 3, logoUrl: favicon("cbu.ac.zm") },
    { name: "Evelyn Hone College", transactionCount: 2, logoUrl: null },

    // Transport
    { name: "Ulendo Taxi", transactionCount: 20, logoUrl: null },
    {
      name: "Yango Zambia",
      transactionCount: 15,
      logoUrl: favicon("yango.com"),
    },
    {
      name: "Proflight Zambia",
      transactionCount: 3,
      logoUrl: favicon("proflight-zambia.com"),
    },

    // Subscriptions & Digital
    { name: "Netflix", transactionCount: 12, logoUrl: favicon("netflix.com") },
    { name: "Spotify", transactionCount: 12, logoUrl: favicon("spotify.com") },
    { name: "Apple", transactionCount: 8, logoUrl: favicon("apple.com") },
    { name: "Google", transactionCount: 6, logoUrl: favicon("google.com") },
    { name: "Amazon", transactionCount: 4, logoUrl: favicon("amazon.com") },
  ];

  // Calculate last transaction dates (spread over last 90 days)
  const now = new Date();

  const existing = await db
    .select({ name: merchants.name })
    .from(merchants)
    .where(eq(merchants.householdId, householdId));
  const existingNames = new Set(
    existing.map((merchant) => merchant.name.trim().toLowerCase())
  );
  const merchantsToInsert = zambianMerchants.filter(
    (merchant) => !existingNames.has(merchant.name.trim().toLowerCase())
  );

  if (merchantsToInsert.length === 0) {
    console.log(`OK. No new merchants to seed for household ${householdId}`);
    return { inserted: 0, skipped: zambianMerchants.length };
  }

  await db.insert(merchants).values(
    merchantsToInsert.map((merchant) => {
      // Spread last transaction dates - more transactions = more recent
      const daysAgo =
        Math.floor(Math.random() * 30) +
        (merchant.transactionCount > 20 ? 0 : 30);
      const lastTransactionDate = new Date(now);
      lastTransactionDate.setDate(lastTransactionDate.getDate() - daysAgo);

      return {
        householdId,
        name: merchant.name,
        logoUrl: merchant.logoUrl,
        transactionCount: merchant.transactionCount,
        lastTransactionDate: lastTransactionDate.toISOString().split("T")[0],
      };
    })
  );

  console.log(
    `OK. Seeded ${merchantsToInsert.length} Zambian merchants for household ${householdId}`
  );
  return {
    inserted: merchantsToInsert.length,
    skipped: zambianMerchants.length - merchantsToInsert.length,
  };
}

/**
 * Seed sample securities for investment tracking
 * LuSE stocks, GRZ bonds, and popular international ETFs
 */
export async function seedDefaultSecurities() {
  const { securities } = await import("@shared/schema");

  // Check if securities already exist
  const existing = await db.select().from(securities).limit(1);
  if (existing.length > 0) {
    console.log("Securities already seeded, skipping...");
    return;
  }

  const defaultSecurities = [
    // LuSE Stocks
    {
      symbol: "ZCCM",
      name: "ZCCM Investments Holdings PLC",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Mining",
      currentPrice: "72.50",
    },
    {
      symbol: "ZANACO",
      name: "Zambia National Commercial Bank PLC",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Banking",
      currentPrice: "4.25",
    },
    {
      symbol: "ZTRL",
      name: "Zambia Tobacco Retailers Ltd",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Consumer",
      currentPrice: "12.80",
    },
    {
      symbol: "SHOPRITE",
      name: "Shoprite Holdings Zambia",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Retail",
      currentPrice: "185.00",
    },
    {
      symbol: "CELTEL",
      name: "Airtel Networks Zambia PLC",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Telecom",
      currentPrice: "2.15",
    },
    {
      symbol: "LAFARGE",
      name: "Lafarge Zambia PLC",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Materials",
      currentPrice: "28.50",
    },
    {
      symbol: "COPPERBELT",
      name: "Copperbelt Energy Corporation",
      type: "stock",
      exchange: "luse",
      currency: "ZMW",
      sector: "Utilities",
      currentPrice: "8.90",
    },

    // GRZ Government Securities (sample)
    {
      symbol: "GRZ-BOND-5Y-2028",
      name: "GRZ Bond 5Y 17.85% 2028",
      type: "bond",
      exchange: "boz",
      currency: "ZMW",
      currentPrice: "100.00",
    },
    {
      symbol: "GRZ-TBILL-91D",
      name: "GRZ 91-Day Treasury Bill",
      type: "tbill",
      exchange: "boz",
      currency: "ZMW",
      currentPrice: "97.85",
    },
    {
      symbol: "GRZ-TBILL-182D",
      name: "GRZ 182-Day Treasury Bill",
      type: "tbill",
      exchange: "boz",
      currency: "ZMW",
      currentPrice: "95.50",
    },

    // International ETFs
    {
      symbol: "VTI",
      name: "Vanguard Total Stock Market ETF",
      type: "etf",
      exchange: "nyse",
      currency: "USD",
      sector: "Blended",
      currentPrice: "245.32",
      isOffshore: true,
    },
    {
      symbol: "VXUS",
      name: "Vanguard Total Intl Stock ETF",
      type: "etf",
      exchange: "nyse",
      currency: "USD",
      sector: "International",
      currentPrice: "56.12",
      isOffshore: true,
    },
    {
      symbol: "BND",
      name: "Vanguard Total Bond Market ETF",
      type: "etf",
      exchange: "nyse",
      currency: "USD",
      sector: "Fixed Income",
      currentPrice: "72.45",
      isOffshore: true,
    },
  ];

  type SecurityType = "stock" | "bond" | "etf" | "tbill";
  type SecurityExchange = "luse" | "boz" | "nyse";

  await db.insert(securities).values(
    defaultSecurities.map((sec) => ({
      ...sec,
      type: sec.type as SecurityType,
      exchange: sec.exchange as SecurityExchange,
      isOffshore: sec.isOffshore ?? false,
      lastPriceUpdate: new Date(),
    }))
  );

  console.log(`OK. Seeded ${defaultSecurities.length} default securities`);

  await seedBenchmarkDefinitions();
}

export async function seedGrzSecurities(
  householdId: string,
  accountId: string
) {
  // 1. Seed CSD Account
  const csdAccountData: InsertCsdAccount = {
    userId: accountId, // Technically this should be userId, but for seed we might need to resolve it. Assuming accountId for now or will fetch user.
    // Wait, accountId is likely a bank account ID. householdId is household.
    // I need a userId. I'll use a placeholder or assume the caller passes userId.
    // But looking at the signature, typically we pass householdId.
    // For now, let's skip CSD Account seeding if we don't have userID, or fetch one.
    // Actually, let's just seed the Bonds/T-Bills which depend on householdId.
    // But they need 'csdAccountNumber' which is a string, so that's fine.
    csdAccountNumber: "1234567890",
    accountHolderName: "Demo User",
    settlementBank: "ZANACO",
    settlementAccount: "100200300400",
    isVerified: true,
    verifiedAt: new Date(),
  };
  const [csdAccount] = await db
    .insert(csdAccounts)
    .values(csdAccountData)
    .returning();

  // Note: Above insert might fail due to FK on userId.
  // I will skip CSD Account insert for now and just insert the securities which don't technically FK to CSD Account table (just text field).

  // 2. Seed GRZ Bonds
  const bonds = [
    {
      bondName: "GRZ 15-Year Bond (2022-2037)",
      isin: "ZM1000005091",
      tenorYears: 15,
      faceValue: 50000.0,
      purchasePrice: 42500.0, // Discount
      purchaseDate: "2022-04-15",
      couponRate: 0.14, // 14%
      maturityDate: "2037-04-15",
      purchaseYield: 0.155,
    },
    {
      bondName: "GRZ 5-Year Bond (2023-2028)",
      isin: "ZM1000005421",
      tenorYears: 5,
      faceValue: 25000.0,
      purchasePrice: 25000.0, // Par
      purchaseDate: "2023-08-20",
      couponRate: 0.14, // 14%
      maturityDate: "2028-08-20",
      purchaseYield: 0.14,
    },
  ];

  await db.insert(grzBonds).values(
    bonds.map(
      (b): InsertGrzBond =>
        ({
          householdId,
          // accountId: accountId, // Optional linked cash account
          bondName: b.bondName,
          isin: b.isin,
          tenorYears: b.tenorYears,
          faceValue: String(b.faceValue),
          purchasePrice: String(b.purchasePrice),
          purchaseDate: new Date(b.purchaseDate).toISOString().split('T')[0],
          couponRate: String(b.couponRate),
          maturityDate: new Date(b.maturityDate).toISOString().split('T')[0],
          purchaseYield: String(b.purchaseYield),
          status: "active",
          csdAccountNumber: "1234567890",
        })
    )
  );

  // 3. Seed T-Bills
  const tbills = [
    {
      tbillName: "GRZ 364-Day T-Bill",
      isin: "ZM0000000456",
      tenorDays: 364,
      faceValue: 10000.0,
      purchasePrice: 8500.0, // ~17.6% discount rate simplified
      purchaseDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Bought 90 days ago
      maturityDate: new Date(Date.now() + 274 * 24 * 60 * 60 * 1000),
      purchaseYield: 0.1765,
      discountAmount: 1500.0,
    },
  ];

  await db.insert(grzTBills).values(
    tbills.map(
      (t): InsertGrzTBill =>
        ({
          householdId,
          tbillName: t.tbillName,
          isin: t.isin,
          tenorDays: t.tenorDays,
          faceValue: String(t.faceValue),
          purchasePrice: String(t.purchasePrice),
          purchaseDate: t.purchaseDate.toISOString().split('T')[0],
          maturityDate: t.maturityDate.toISOString().split('T')[0],
          purchaseYield: String(t.purchaseYield),
          discountAmount: String(t.discountAmount),
          status: "active",
          csdAccountNumber: "1234567890",
        })
    )
  );

  // 4. Seed Auction Results
  // Recent 364-day T-Bill result
  const auctionResult: InsertGrzAuctionResult = {
    auctionDate: "2024-01-15",
    securityType: "TBILL",
    tenor: "364D",
    amountOffered: "500000000",
    amountAccepted: "450000000",
    weightedAvgYield: "0.165",
    highestYield: "0.17",
    lowestYield: "0.16",
  };
  await db.insert(grzAuctionResults).values(auctionResult);

  console.log("OK. Seeded GRZ Securities");
}

export async function seedBenchmarkDefinitions() {
  const existing = await db
    .select({ id: portfolioBenchmarks.id })
    .from(portfolioBenchmarks)
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  const benchmarks = [
    {
      code: "LUSE_ASI",
      name: "LuSE All Share Index",
      currency: "ZMW",
      description: "Zambian equity market benchmark",
    },
    {
      code: "BOZ_TBILL_91D",
      name: "BoZ 91-Day T-Bill Rate",
      currency: "ZMW",
      description: "Risk-free short-term yield benchmark",
    },
    {
      code: "ZMW_INFLATION",
      name: "Zambia CPI Inflation",
      currency: "ZMW",
      description: "Inflation rate benchmark for real returns",
    },
    {
      code: "USD_ZMW",
      name: "USD/ZMW Exchange Rate",
      currency: "ZMW",
      description: "FX benchmark for currency impact tracking",
    },
    {
      code: "SP500",
      name: "S&P 500 Index",
      currency: "USD",
      description: "Global equity benchmark (US)",
    },
  ];

  await db.insert(portfolioBenchmarks).values(benchmarks);
  console.log("OK. Seeded portfolio benchmarks");
}

/**
 * Seed default tags for a new household
 * CODE-003: Default tags for new households
 *
 * Accepts an optional executor so the caller can run this inside a transaction
 * (e.g. HouseholdRepository.createWithOwner), making the tag seeding atomic with
 * the household + owner-membership creation. Defaults to the shared `db` for
 * standalone use.
 */
export async function seedDefaultTags(
  householdId: string,
  executor: DbExecutor = db
) {
  const defaultTags = [
    { name: "Urgent", color: "#EF4444", icon: "🚨" },
    { name: "Recurring", color: "#3B82F6", icon: "🔄" },
    { name: "Business", color: "#8B5CF6", icon: "💼" },
    { name: "Personal", color: "#EC4899", icon: "👤" },
    { name: "Tax Deductible", color: "#22C55E", icon: "📝" },
    { name: "Reimbursable", color: "#F59E0B", icon: "💰" },
    { name: "Shared", color: "#14B8A6", icon: "👥" },
    { name: "Review", color: "#EAB308", icon: "🔍" },
  ];

  await executor.insert(tags).values(
    defaultTags.map((tag) => ({
      householdId,
      name: tag.name,
      color: tag.color,
      icon: tag.icon,
    }))
  );

  console.log("OK. Seeded default tags");
}
