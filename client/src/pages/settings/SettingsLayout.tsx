import React from "react";
import Layout from "@/components/Layout";
import { cn } from "@/lib/utils";
import {
  SETTINGS_SECTIONS,
  SECTION_LABELS,
  type SettingsSection,
} from "@/features/settings/constants/sectionNames";
import {
  User,
  Monitor,
  Bell,
  Shield,
  Home,
  Users,
  Store,
  SlidersHorizontal,
  FolderTree,
  LogOut,
  Menu,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { authApi } from "@/lib/api";

interface SettingsLayoutProps {
  readonly children: React.ReactNode;
  readonly activeSection: SettingsSection;
  readonly onSectionChange: (section: SettingsSection) => void;
}

const iconMap: Record<SettingsSection, any> = {
  [SETTINGS_SECTIONS.PROFILE]: User,
  [SETTINGS_SECTIONS.DISPLAY]: Monitor,
  [SETTINGS_SECTIONS.NOTIFICATIONS]: Bell,
  [SETTINGS_SECTIONS.SECURITY]: Shield,
  [SETTINGS_SECTIONS.HOUSEHOLD]: Home,
  [SETTINGS_SECTIONS.MEMBERS]: Users,
  [SETTINGS_SECTIONS.PREFERENCES]: SlidersHorizontal,
  [SETTINGS_SECTIONS.ORGANIZATION]: FolderTree,
  [SETTINGS_SECTIONS.MERCHANTS]: Store,
  [SETTINGS_SECTIONS.WEEKLY_RECAP]: Calendar,
};

// ... (imports remain)

function SidebarContent({
  activeSection,
  onSectionChange,
  sections,
}: {
  readonly activeSection: SettingsSection;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly sections: SettingsSection[];
}) {
  return (
    <div className="flex flex-col h-full">
      <h1 className="text-lg font-semibold mb-4 px-3">Settings</h1>
      <div className="space-y-1 flex-1">
        {sections.map((section) => {
          const Icon = iconMap[section];
          const isActive = activeSection === section;

          return (
            <button
              key={section}
              onClick={() => onSectionChange(section)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "bg-accent text-accent-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
              aria-label={`Navigate to ${SECTION_LABELS[section]} settings`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{SECTION_LABELS[section]}</span>
            </button>
          );
        })}
      </div>

      <div className="pt-4 mt-4 border-t">
        <button
          onClick={async () => {
            try {
              await authApi.logout();
              globalThis.location.href = "/login";
            } catch (error) {
              console.error("Logout failed:", error);
            }
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}

export function SettingsLayout({
  children,
  activeSection,
  onSectionChange,
}: SettingsLayoutProps) {
  const sections = Object.values(SETTINGS_SECTIONS);

  return (
    <Layout fullWidth>
      <div className="flex min-h-screen">
        {/* Desktop Sidebar */}
        <nav
          className="hidden md:flex w-64 border-r bg-card p-4 flex-col"
          aria-label="Settings navigation"
        >
          <SidebarContent
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            sections={sections}
          />
        </nav>

        {/* Mobile Sidebar (Sheet) */}
        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 left-4 z-40"
              >
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle settings menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64">
              <div className="h-full py-4">
                <SidebarContent
                  activeSection={activeSection}
                  onSectionChange={onSectionChange}
                  sections={sections}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 pt-16 md:pt-6 overflow-auto">
          {children}
        </main>
      </div>
    </Layout>
  );
}
