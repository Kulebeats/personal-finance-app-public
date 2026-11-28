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
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authApi } from "@/lib/api";

interface SettingsLayoutProps {
  readonly children: React.ReactNode;
  readonly activeSection: SettingsSection;
  readonly onSectionChange: (section: SettingsSection) => void;
}

const iconMap: Record<SettingsSection, LucideIcon> = {
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

function SidebarContent({
  activeSection,
  onSectionChange,
  sections,
  showHeading = true,
}: {
  readonly activeSection: SettingsSection;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly sections: SettingsSection[];
  readonly showHeading?: boolean;
}) {
  return (
    <div className="flex flex-col h-full">
      {showHeading && <h2 className="text-lg font-semibold mb-4 px-3">Settings</h2>}
      <div className="space-y-1 flex-1">
        {sections.map((section) => {
          const Icon = iconMap[section];
          const isActive = activeSection === section;

          return (
            <button
              type="button"
              key={section}
              onClick={() => onSectionChange(section)}
              className={cn(
                "w-full min-h-11 flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm font-medium transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "bg-accent text-accent-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
              aria-label={`Navigate to ${SECTION_LABELS[section]} settings`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{SECTION_LABELS[section]}</span>
            </button>
          );
        })}
      </div>

      <div className="pt-4 mt-4 border-t">
        <button
          type="button"
          onClick={async () => {
            try {
              await authApi.logout();
              globalThis.location.href = "/login";
            } catch (error) {
              console.error("Logout failed:", error);
            }
          }}
          className="w-full min-h-11 flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
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
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const desktopNavigation = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches && mobileOpen) {
        setMobileOpen(false);
      }
    };
    desktop.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [mobileOpen]);

  return (
    <Layout fullWidth>
      <div className="flex min-h-full min-w-0">
        {/* Desktop Sidebar. UX-02: narrower from 768 px until lg, where the app sidebar and this
            list together left the settings content too narrow to fit (it scrolled sideways). */}
        <nav
          ref={desktopNavigation}
          className="hidden md:flex w-48 lg:w-64 shrink-0 border-r bg-card p-4 flex-col"
          aria-label="Settings navigation"
        >
          <SidebarContent
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            sections={sections}
          />
        </nav>

        {/* Mobile Sidebar (Sheet) */}
        <div className="min-w-0 flex-1">
          <div className="border-b bg-card px-4 py-3 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                type="button"
                className="h-auto min-h-11 max-w-full justify-start whitespace-normal px-3 py-2 text-left"
                aria-label="Open settings menu"
              >
                <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>Settings menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              aria-modal="true"
              className="w-[calc(100vw_-_2rem)] max-w-xs overflow-y-auto p-4 sm:max-w-xs [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center"
              onCloseAutoFocus={event => {
                if (window.matchMedia("(min-width: 768px)").matches) {
                  event.preventDefault();
                  desktopNavigation.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
                }
              }}
            >
              <SheetHeader className="pr-12 text-left">
                <SheetTitle className="break-words">Settings navigation</SheetTitle>
                <SheetDescription>Choose a section to manage your settings.</SheetDescription>
              </SheetHeader>
              <nav className="mt-4" aria-label="Settings sections">
                <SidebarContent
                  activeSection={activeSection}
                  onSectionChange={section => {
                    onSectionChange(section);
                    setMobileOpen(false);
                  }}
                  sections={sections}
                  showHeading={false}
                />
              </nav>
            </SheetContent>
          </Sheet>
          </div>

        {/* Main Content */}
        <section aria-label="Settings content" className="min-w-0 p-4 md:p-6">
          {children}
        </section>
        </div>
      </div>
    </Layout>
  );
}
