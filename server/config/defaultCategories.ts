/**
 * Default Categories Configuration
 *
 * Defines the default category groups and categories that are seeded
 * for new households. This can be customized based on regional requirements
 * or user preferences.
 *
 * @module config/defaultCategories
 */

export interface DefaultCategoryGroup {
  name: string;
  type: "income" | "expenses" | "transfers";
  displayOrder: number;
  budgetMode: "by_category" | "by_group";
  rolloverEnabled: boolean;
  isArchived: boolean;
}

export interface DefaultCategory {
  group: string; // Reference to group name
  name: string;
  icon: string;
}

export const DEFAULT_CATEGORY_GROUPS: DefaultCategoryGroup[] = [
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
];

export const DEFAULT_GROUP_COLORS: Record<string, string> = {
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

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
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
];
