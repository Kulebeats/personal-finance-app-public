import { Menu, Search } from "lucide-react";
import type { Ref } from "react";

import { Breadcrumbs, type Breadcrumb } from "@/components/layout/Breadcrumbs";
import { NotificationBell } from "@/components/NotificationBell";
import { ProfileMenu, type Profile } from "@/components/layout/ProfileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SheetTrigger } from "@/components/ui/sheet";

type TopBarProps = {
  navigationTriggerRef: Ref<HTMLButtonElement>;
  breadcrumbs: Breadcrumb[];
  onToggleCommandPalette: () => void;
  profile?: Profile | null;
};

export function TopBar({
  navigationTriggerRef,
  breadcrumbs,
  onToggleCommandPalette,
  profile,
}: TopBarProps) {
  return (
    <header className="min-h-16 shrink-0 border-b border-border bg-background/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 px-3 py-2 md:px-8 sticky top-0 z-10">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:basis-48 md:gap-4 max-w-2xl">
        <SheetTrigger asChild>
          <button ref={navigationTriggerRef} type="button" aria-label="Open application navigation" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:hidden">
            <Menu className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          </button>
        </SheetTrigger>

        <span className="min-w-0 truncate text-sm font-semibold md:hidden">
          {breadcrumbs[breadcrumbs.length - 1]?.label ?? "Dashboard"}
        </span>
        <div className="hidden min-w-0 md:block"><Breadcrumbs breadcrumbs={breadcrumbs} /></div>

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

      <div className="flex shrink-0 items-center gap-2 md:gap-4">
        {/* NEW-37: the "Mine / Joint View / Partner" selector was removed. It had
            no handler and no page reads a household view scope; per-page owner
            filters (e.g. Transactions "Owner") are the working control. */}
        <ThemeToggle />
        <NotificationBell />
        <ProfileMenu profile={profile} />
      </div>
    </header>
  );
}
