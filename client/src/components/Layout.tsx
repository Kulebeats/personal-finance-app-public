import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

import { useProfile, useHouseholdMembers } from "@/hooks/use-settings";
import { useAccounts } from "@/hooks/useAccounts";
import { useSettings } from "@/contexts/SettingsContext";
import { useCommandPalette } from "@/contexts/CommandPaletteContext";
import { GoalMilestoneModal } from "@/features/goals/components/GoalMilestoneModal";
import { BREADCRUMB_MAP } from "@/components/layout/constants";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

export default function Layout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { sidebarCollapsed: collapsed, toggleSidebar } = useSettings();
  const { toggle: toggleCommandPalette } = useCommandPalette();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: profile, error: profileError } = useProfile();
  const { data: accounts } = useAccounts();
  const { data: members = [] } = useHouseholdMembers();

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

  useEffect(() => {
    const status = (profileError as { status?: number } | null)?.status;
    if (status === 401) {
      setLocation("/login");
    }
  }, [profileError, setLocation]);

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
  const hasPartnerView = members.some((member) => member.userId !== profile?.id);

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans overflow-hidden">
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
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background/50"
      >
        <TopBar
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          breadcrumbs={breadcrumbs}
          onToggleCommandPalette={toggleCommandPalette}
          hasPartnerView={hasPartnerView}
          profile={profile}
        />

        <div className="flex-1 overflow-y-auto scroll-smooth bg-background/50">
          <div
            className={cn(
              fullWidth ? "w-full min-h-full" : "max-w-7xl mx-auto p-8"
            )}
          >
            {children}
          </div>
        </div>
      </main>

      <GoalMilestoneModal />
    </div>
  );
}
