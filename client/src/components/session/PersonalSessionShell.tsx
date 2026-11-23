import { userErrorMessage } from "@/lib/errorCopy";
import { lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";
import { authApi } from "@/lib/api";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CreateHouseholdForm } from "@/pages/settings/sections/HouseholdSection/components/CreateHouseholdForm";

const Profile = lazy(() => import("@/pages/settings/sections/ProfileSection"));
const Display = lazy(() => import("@/pages/settings/sections/DisplaySection"));
const Security = lazy(() => import("@/pages/settings/sections/SecuritySection"));

export function PersonalSessionShell() {
  const [location] = useLocation();
  const Section = location === "/profile" || location === "/settings/profile" || location === "/settings" ? Profile : location === "/settings/display" ? Display : location === "/settings/security" ? Security : null;
  return <main className="mx-auto max-w-4xl p-6 space-y-6">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold">Welcome to Capital</h1>
      <ThemeToggle />
    </div>
    <nav aria-label="Personal settings" className="flex flex-wrap gap-4">
      <Link href="/settings/profile">Profile</Link><Link href="/settings/display">Display</Link><Link href="/settings/security">Security</Link><Link href="/settings/household">Create household</Link>
      <button onClick={() => { void authApi.logout().catch(error => toast.error("Unable to sign out", { description: userErrorMessage(error, "Please try again.") })); }}>Sign out</button>
    </nav>
    {Section ? <Suspense fallback={<p role="status">Loading settings…</p>}><Section /></Suspense> : <CreateHouseholdForm currencies={[
      { code: "ZMW", name: "Zambian Kwacha", symbol: "K" }, { code: "USD", name: "US Dollar", symbol: "$" }, { code: "EUR", name: "Euro", symbol: "€" }, { code: "GBP", name: "British Pound", symbol: "£" }, { code: "ZAR", name: "South African Rand", symbol: "R" },
    ]} />}
  </main>;
}
