import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { LogOut, Settings, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { authApi } from "@/lib/api";
import { getInitials } from "@/hooks/use-settings";

export type Profile = {
  id?: string;
  fullName?: string | null;
  email?: string | null;
  profilePictureUrl?: string | null;
};

type ProfileMenuProps = {
  profile?: Profile | null;
};

export function ProfileMenu({ profile }: ProfileMenuProps) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setShowProfileMenu(false);
      }
    };

    if (showProfileMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showProfileMenu]);

  return (
    <div className="relative" ref={profileMenuRef}>
      <button
        onClick={() => setShowProfileMenu(!showProfileMenu)}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={showProfileMenu}
        className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm border-2 border-white shadow-sm hover:shadow-md transition-all overflow-hidden bg-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {profile?.profilePictureUrl ? (
          <ProtectedImage
            src={profile.profilePictureUrl}
            alt=""
            className="w-full h-full object-cover object-center"
            style={{ imageRendering: "auto" }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
              target.nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <div
          aria-hidden="true"
          className={cn(
            "w-full h-full flex items-center justify-center text-white",
            profile?.profilePictureUrl && "hidden"
          )}
        >
          {getInitials(profile?.fullName)}
        </div>
      </button>

      {showProfileMenu && (
        <div className="absolute right-0 mt-2 w-80 bg-card rounded-xl shadow-2xl border border-border overflow-hidden z-50">
          <div className="p-6 text-center bg-linear-to-b from-muted/40 to-card">
            <div className="flex justify-center mb-4">
              <div
                aria-hidden="true"
                className="w-24 h-24 rounded-full flex items-center justify-center font-bold text-2xl border-4 border-white shadow-lg overflow-hidden bg-gray-400"
              >
                {profile?.profilePictureUrl ? (
                  <ProtectedImage
                    src={profile.profilePictureUrl}
                    alt=""
                    className="w-full h-full object-cover object-center"
                    style={{ imageRendering: "auto" }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white">
                    {getInitials(profile?.fullName)}
                  </div>
                )}
              </div>
            </div>
            <h3 className="font-semibold text-lg mb-1">
              {profile?.fullName || "User"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {profile?.email}
            </p>
            <Link href="/profile">
              <button
                onClick={() => setShowProfileMenu(false)}
                className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
              >
                Manage your Account
              </button>
            </Link>
          </div>

          <div className="py-2">
            <Link href="/profile">
              <button
                onClick={() => setShowProfileMenu(false)}
                className="w-full px-6 py-3 text-left hover:bg-muted transition-colors flex items-center gap-3"
              >
                <User className="w-5 h-5 text-gray-600" />
                <span className="text-sm font-medium">Customize profile</span>
              </button>
            </Link>
            <Link href="/profile">
              <button
                onClick={() => setShowProfileMenu(false)}
                className="w-full px-6 py-3 text-left hover:bg-muted transition-colors flex items-center gap-3"
              >
                <Settings className="w-5 h-5 text-gray-600" />
                <span className="text-sm font-medium">Settings</span>
              </button>
            </Link>
          </div>

          <div className="border-t border-border">
            <button
              onClick={async () => {
                try {
                  await authApi.logout();
                  window.location.href = "/login";
                } catch (error) {
                  console.error("Logout failed:", error);
                }
              }}
              className="w-full px-6 py-3 text-left hover:bg-muted transition-colors flex items-center gap-3"
            >
              <LogOut className="w-5 h-5 text-gray-600" />
              <span className="text-sm font-medium">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
import { ProtectedImage } from "@/components/session/ProtectedImage";
