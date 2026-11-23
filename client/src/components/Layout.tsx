import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

import { useProfile } from "@/hooks/use-settings";
import { useAccounts } from "@/hooks/useAccounts";
import { useSettings } from "@/contexts/SettingsContext";
import { useCommandPalette } from "@/contexts/CommandPaletteContext";
import { GoalMilestoneModal } from "@/features/goals/components/GoalMilestoneModal";
import { BREADCRUMB_MAP } from "@/components/layout/constants";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useApplicationNavigation } from "@/components/layout/useApplicationNavigation";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export default function Layout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const navigation = useApplicationNavigation(location);
  const { sidebarCollapsed: collapsed, toggleSidebar } = useSettings();
  const { toggle: toggleCommandPalette } = useCommandPalette();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: profile } = useProfile();
  const { data: accounts } = useAccounts();

  useEffect(() => {
    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        !!target?.closest("input, textarea") || target?.isContentEditable;

      const key = event.key.toLowerCase();
      const isMeta = event.metaKey || event.ctrlKey;

      if (!isEditable && (key === "/" || (key === "k" && isMeta))) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (isMeta && event.shiftKey && key === "m") {
        event.preventDefault();
        setLocation("/settings/merchants");
        return;
      }

      if (isMeta && event.shiftKey && key === "r") {
        event.preventDefault();
        setLocation("/settings/rules");
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => {
      window.removeEventListener("keydown", handleGlobalShortcuts);
    };
  }, [setLocation]);

  const generateBreadcrumbs = () => {
    const parts = location.split("/").filter(Boolean);

    if (location === "/") return [];

    const crumbs = [] as { href: string; label: string }[];
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += `/${part}`;

      let label =
        BREADCRUMB_MAP[currentPath] ||
        part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, " ");

      if (parts[0] === "accounts" && i === 1) {
        if (accounts) {
          const account = accounts.find((a) => a.id === part);
          if (account) {
            label = account.name;
          } else {
            label = "Account Details";
          }
        } else {
          label = "Account Details";
        }
      }

      crumbs.push({ href: currentPath, label });
    }
    return crumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  return (
    <Sheet open={navigation.mobileOpen} onOpenChange={navigation.onOpenChange}>
    <div className="flex h-dvh w-full bg-background text-foreground font-sans overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggle={toggleSidebar}
        location={location}
        profileName={profile?.fullName}
        navigationRef={navigation.desktopRef}
      />

      {!navigation.leaving && <SheetContent
        ref={navigation.contentRef}
        side="left"
        aria-modal="true"
        className="flex h-dvh max-h-dvh w-[calc(100vw_-_2rem)] max-w-xs flex-col gap-0 overflow-hidden bg-sidebar p-0 text-sidebar-foreground sm:max-w-xs [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center"
        onCloseAutoFocus={navigation.onCloseAutoFocus}
      >
        <SheetHeader className="shrink-0 p-4 pr-14 text-left">
          <SheetTitle>Application navigation</SheetTitle>
          <SheetDescription>Choose a page in Capital.</SheetDescription>
        </SheetHeader>
        <Sidebar
          variant="mobile"
          collapsed={false}
          onToggle={toggleSidebar}
          location={location}
          profileName={profile?.fullName}
          onNavigate={navigation.onNavigate}
        />
      </SheetContent>}

      <main
        ref={navigation.mainRef}
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background/50"
      >
        <TopBar
          navigationTriggerRef={navigation.triggerRef}
          breadcrumbs={breadcrumbs}
          onToggleCommandPalette={toggleCommandPalette}
          profile={profile}
        />

        <div data-main-scroll className="flex-1 overflow-y-auto scroll-smooth bg-background/50">
          <div
            className={cn(
              fullWidth ? "w-full min-h-full" : "max-w-7xl mx-auto p-4 md:p-8"
            )}
          >
            {children}
          </div>
        </div>
      </main>

      <GoalMilestoneModal />
    </div>
    </Sheet>
  );
}
