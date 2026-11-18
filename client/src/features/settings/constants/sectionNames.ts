export const SETTINGS_SECTIONS = {
  PROFILE: "profile",
  DISPLAY: "display",
  NOTIFICATIONS: "notifications",
  SECURITY: "security",
  HOUSEHOLD: "household",
  MEMBERS: "members",
  PREFERENCES: "preferences",
  ORGANIZATION: "organization",
  MERCHANTS: "merchants",
  WEEKLY_RECAP: "weekly-recap",
} as const;

export type SettingsSection =
  (typeof SETTINGS_SECTIONS)[keyof typeof SETTINGS_SECTIONS];

// Organization sub-tabs
export const ORGANIZATION_TABS = {
  CATEGORIES: "categories",
  TAGS: "tags",
  RULES: "rules",
} as const;

export type OrganizationTab =
  (typeof ORGANIZATION_TABS)[keyof typeof ORGANIZATION_TABS];

export const SECTION_LABELS: Record<SettingsSection, string> = {
  [SETTINGS_SECTIONS.PROFILE]: "Profile",
  [SETTINGS_SECTIONS.DISPLAY]: "Display",
  [SETTINGS_SECTIONS.NOTIFICATIONS]: "Notifications",
  [SETTINGS_SECTIONS.SECURITY]: "Security",
  [SETTINGS_SECTIONS.HOUSEHOLD]: "Household",
  [SETTINGS_SECTIONS.MEMBERS]: "Members",
  [SETTINGS_SECTIONS.PREFERENCES]: "Preferences",
  [SETTINGS_SECTIONS.ORGANIZATION]: "Organization",
  [SETTINGS_SECTIONS.MERCHANTS]: "Merchants",
  [SETTINGS_SECTIONS.WEEKLY_RECAP]: "Weekly Recap",
};

export const SECTION_ICONS: Record<SettingsSection, string> = {
  [SETTINGS_SECTIONS.PROFILE]: "User",
  [SETTINGS_SECTIONS.DISPLAY]: "Monitor",
  [SETTINGS_SECTIONS.NOTIFICATIONS]: "Bell",
  [SETTINGS_SECTIONS.SECURITY]: "Shield",
  [SETTINGS_SECTIONS.HOUSEHOLD]: "Home",
  [SETTINGS_SECTIONS.MEMBERS]: "Users",
  [SETTINGS_SECTIONS.PREFERENCES]: "Sliders",
  [SETTINGS_SECTIONS.ORGANIZATION]: "FolderTree",
  [SETTINGS_SECTIONS.MERCHANTS]: "Store",
  [SETTINGS_SECTIONS.WEEKLY_RECAP]: "Calendar",
};

export const ORGANIZATION_TAB_LABELS: Record<OrganizationTab, string> = {
  [ORGANIZATION_TABS.CATEGORIES]: "Categories",
  [ORGANIZATION_TABS.TAGS]: "Tags",
  [ORGANIZATION_TABS.RULES]: "Rules",
};
