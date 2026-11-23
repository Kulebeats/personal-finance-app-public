import { Link } from "wouter";
import type { MouseEvent, Ref } from "react";
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
  variant?: "desktop" | "mobile";
  navigationRef?: Ref<HTMLElement>;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

export function Sidebar({
  collapsed,
  onToggle,
  location,
  profileName,
  variant = "desktop",
  navigationRef,
  onNavigate,
}: SidebarProps) {
  const mobile = variant === "mobile";
  return (
    <aside
      ref={navigationRef}
      className={cn(
        "min-h-0 bg-sidebar text-sidebar-foreground flex-col",
        mobile ? "flex flex-1 overflow-y-auto" : "hidden shrink-0 border-r border-sidebar-border transition-all duration-300 ease-in-out md:flex",
        !mobile && (collapsed ? "w-16" : "w-64")
      )}
    >
      {!mobile && <div
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
      </div>}

      <nav aria-label="Application navigation" className={cn("px-3 pb-4 space-y-6 scrollbar-thin scrollbar-thumb-sidebar-accent scrollbar-track-transparent", mobile ? "shrink-0" : "min-h-0 flex-1 overflow-y-auto")}>
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
                <Link key={item.href} href={item.href}
                    onClick={event => onNavigate?.(event, item.href)}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "min-h-11 flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 p-3 border-t border-sidebar-border space-y-1">
        <Link href="/profile"
            onClick={event => onNavigate?.(event, "/profile")}
            aria-current={location === "/profile" ? "page" : undefined}
            aria-label={`Profile: ${profileName || "User"}`}
            className={cn(
              "min-h-11 w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all cursor-pointer mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
        </Link>
      </div>
    </aside>
  );
}
