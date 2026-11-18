import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ChevronRight, PanelLeftClose } from "lucide-react";
import logo from "@assets/generated_images/modern_abstract_butterfly_finance_logo.png";

import { getInitials } from "@/hooks/use-settings";
import { NAV_GROUPS } from "@/components/layout/constants";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  location: string;
  profileName?: string | null;
};

export function Sidebar({
  collapsed,
  onToggle,
  location,
  profileName,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex-shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "p-4 flex items-center",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        <div className={cn("flex items-center gap-3", collapsed && "hidden")}>
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-primary/20 flex items-center justify-center shrink-0">
            <img
              src={logo}
              alt="Capital Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <span className="font-bold text-lg tracking-tight whitespace-nowrap">
            Capital
          </span>
        </div>

        {collapsed && (
          <button
            className="w-8 h-8 rounded-lg overflow-hidden bg-primary/20 flex items-center justify-center shrink-0 cursor-pointer border-0 p-0"
            onClick={() => onToggle()}
            aria-label="Expand sidebar"
          >
            <img
              src={logo}
              alt="Capital Logo"
              className="w-full h-full object-cover"
            />
          </button>
        )}

        {!collapsed && (
          <button
            onClick={() => onToggle()}
            aria-label="Collapse sidebar"
            className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 pb-4 space-y-6 overflow-y-auto scrollbar-thin scrollbar-thumb-sidebar-accent scrollbar-track-transparent">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            {!collapsed && (
              <h3 className="px-3 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 mb-1">
                {group.title}
              </h3>
            )}

            {group.items.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    aria-current={isActive ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                      collapsed && "justify-center px-2"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon
                      className={cn(
                        "shrink-0",
                        collapsed ? "w-5 h-5" : "w-4 h-4 opacity-80"
                      )}
                      aria-hidden="true"
                    />
                    {!collapsed && (
                      <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                        {item.label}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-1">
        <Link href="/profile">
          <div
            role="button"
            tabIndex={0}
            aria-label={`Profile: ${profileName || "User"}`}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all cursor-pointer mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "justify-center px-2"
            )}
          >
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0" aria-hidden="true">
              {getInitials(profileName)}
            </div>
            {!collapsed && (
              <div className="flex-1 flex items-center justify-between overflow-hidden">
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                  {profileName || "User"}
                </span>
                <ChevronRight className="w-3 h-3 opacity-50" aria-hidden="true" />
              </div>
            )}
          </div>
        </Link>
      </div>
    </aside>
  );
}
