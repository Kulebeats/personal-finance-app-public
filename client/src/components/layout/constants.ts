import {
  LayoutDashboard,
  CreditCard,
  Wallet,
  PieChart,
  TrendingUp,
  Settings,
  BarChart3,
  Repeat,
  Target,
  Lightbulb,
  ArrowLeftRight,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const BREADCRUMB_MAP: Record<string, string> = {
  "/": "Dashboard",
  "/accounts": "Accounts",
  "/transactions": "Transactions",
  "/cash-flow": "Cash Flow",
  "/reports": "Reports",
  "/budget": "Budget",
  "/recurring": "Recurring",
  "/goals": "Goals",
  "/investments": "Investments",
  "/advice": "Advice",
};

export type NavItem = {
  icon: LucideIcon;
  label: string;
  href: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Track",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", href: "/" },
      { icon: Wallet, label: "Accounts", href: "/accounts" },
      { icon: CreditCard, label: "Transactions", href: "/transactions" },
      { icon: FileText, label: "Receipts", href: "/receipts" },
      { icon: ArrowLeftRight, label: "Cash Flow", href: "/cash-flow" },
      { icon: PieChart, label: "Reports", href: "/reports" },
    ],
  },
  {
    title: "Plan",
    items: [
      { icon: BarChart3, label: "Budget", href: "/budget" },
      { icon: Repeat, label: "Recurring", href: "/recurring" },
      { icon: Target, label: "Goals", href: "/goals" },
      { icon: TrendingUp, label: "Investments", href: "/investments" },
      { icon: Lightbulb, label: "Advice", href: "/advice" },
      { icon: Settings, label: "Settings", href: "/profile" },
    ],
  },
];
