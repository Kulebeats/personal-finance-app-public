import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { authApi } from "@/lib/api";

export type Section =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "household-general"
  | "members"
  | "preferences"
  | "institutions"
  | "categories"
  | "merchants"
  | "rules"
  | "tags"
  | "data"
  | "billing"
  | "referrals";

interface SettingsSidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
}

export function SettingsSidebar({
  activeSection,
  onSectionChange,
}: SettingsSidebarProps) {
  const [location, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await authApi.logout();
      toast.success("Logged out successfully");
      // Clear any cached data by reloading the page
      window.location.href = "/login";
    } catch {
      toast.error("Failed to logout");
    }
  };

  const handleSectionChange = (section: Section) => {
    onSectionChange(section);
    // Update URL to reflect the current section
    setLocation(`/settings/${section}`);
    setIsMobileOpen(false);
  };

  const SidebarItem = ({ id, label }: { id: Section; label: string }) => (
    <button
      onClick={() => handleSectionChange(id)}
      className={cn(
        "w-full text-left px-4 py-2 text-sm rounded-md transition-colors",
        activeSection === id
          ? "bg-blue-50 text-blue-600 font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  const SidebarContent = () => (
    <>
      <div>
        <h3 className="px-4 text-sm font-semibold text-foreground mb-2">
          Account
        </h3>
        <div className="space-y-1">
          <SidebarItem id="profile" label="Profile" />
          <SidebarItem id="display" label="Display" />
          <SidebarItem id="notifications" label="Notifications" />
          <SidebarItem id="security" label="Security" />
        </div>
      </div>

      <div>
        <h3 className="px-4 text-sm font-semibold text-foreground mb-2">
          Household
        </h3>
        <div className="space-y-1">
          <SidebarItem id="household-general" label="General" />
          <SidebarItem id="members" label="Members" />
          <SidebarItem id="categories" label="Categories" />
          <SidebarItem id="merchants" label="Merchants" />
          <SidebarItem id="rules" label="Rules" />
        </div>
      </div>

      {/* Logout Button */}
      <div className="pt-4 mt-auto border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleLogout}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Menu Button */}
      <div className="md:hidden mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="w-full justify-between"
        >
          <span>
            {activeSection
              .replace("-", " ")
              .replace(/\b\w/g, (l) => l.toUpperCase())}
          </span>
          {isMobileOpen ? (
            <X className="w-4 h-4" />
          ) : (
            <Menu className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Mobile Sidebar (collapsible) */}
      {isMobileOpen && (
        <div className="md:hidden mb-6 p-4 border border-border rounded-lg bg-background space-y-6">
          <SidebarContent />
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-col md:w-64 shrink-0 space-y-6 min-h-[400px]">
        <SidebarContent />
      </div>
    </>
  );
}
