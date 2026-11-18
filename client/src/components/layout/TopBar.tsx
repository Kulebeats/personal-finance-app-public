import { PanelLeftOpen, Search } from "lucide-react";

import { Breadcrumbs, type Breadcrumb } from "@/components/layout/Breadcrumbs";
import { NotificationBell } from "@/components/NotificationBell";
import { ProfileMenu, type Profile } from "@/components/layout/ProfileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";

type TopBarProps = {
  collapsed: boolean;
  onToggleSidebar: () => void;
  breadcrumbs: Breadcrumb[];
  onToggleCommandPalette: () => void;
  hasPartnerView: boolean;
  profile?: Profile | null;
};

export function TopBar({
  collapsed,
  onToggleSidebar,
  breadcrumbs,
  onToggleCommandPalette,
  hasPartnerView,
  profile,
}: TopBarProps) {
  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10">
      <div className="flex items-center gap-4 w-full max-w-2xl">
        {collapsed && (
          <button onClick={() => onToggleSidebar()} aria-label="Open sidebar" className="mr-2 md:hidden">
            <PanelLeftOpen className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          </button>
        )}

        <Breadcrumbs breadcrumbs={breadcrumbs} />

        <button
          onClick={() => onToggleCommandPalette()}
          aria-label="Open command palette"
          className="hidden md:flex flex-1 max-w-sm items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background text-sm text-muted-foreground hover:bg-muted/50 transition-colors group"
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            <span className="text-xs">?~</span>K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div
          role="radiogroup"
          aria-label="Account view selector"
          className="items-center bg-muted/30 rounded-full p-1 border border-border/50 hidden sm:flex"
        >
          <button
            role="radio"
            aria-checked="true"
            aria-label="View my accounts only"
            className="px-3 py-1 rounded-full bg-card shadow-sm text-xs font-medium text-foreground transition-all"
          >
            Mine
          </button>
          <button
            role="radio"
            aria-checked="false"
            aria-label="View joint accounts"
            className="px-3 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
          >
            Joint View
          </button>
          {hasPartnerView && (
            <button
              role="radio"
              aria-checked="false"
              aria-label="View partner accounts"
              className="px-3 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
            >
              Partner
            </button>
          )}
        </div>
        <ThemeToggle />
        <NotificationBell />
        <ProfileMenu profile={profile} />
      </div>
    </header>
  );
}
