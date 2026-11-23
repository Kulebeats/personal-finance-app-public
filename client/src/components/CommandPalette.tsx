import * as React from "react";
import { useLocation } from "wouter";
import { useTheme } from "next-themes";
import {
  CreditCard,
  LayoutDashboard,
  Settings,
  Wallet,
  PieChart,
  Repeat,
  Target,
  FileText,
  Sun,
  Moon,
  Laptop,
  ArrowRightLeft,
  Receipt,
  PanelLeft,
  DollarSign,
  TrendingUp,
  Tag,
  Bookmark,
  Filter,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useAccounts } from "@/hooks";
import { useCategories } from "@/hooks/useCategories";
import { useSettings } from "@/contexts/SettingsContext";
import { useCommandPalette } from "@/contexts/CommandPaletteContext";
import { useFilterPresets } from "@/features/transactions/hooks/useFilterPresets";
import { buildTransactionsUrl } from "@/features/transactions/transactionFilterParams";
import { presetToTransactionFilters } from "@/features/transactions/filterPresetFilters";

export function CommandPalette() {
  const { open, setOpen, toggle } = useCommandPalette();
  const [, setLocation] = useLocation();
  const { setTheme, theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: categoriesData } = useCategories();
  const { data: filterPresets } = useFilterPresets("transactions");
  const { toggleSidebar } = useSettings();

  const categories = categoriesData?.categories || [];

  // Global Key Handler
  React.useEffect(() => {
    let lastKeyTime = 0;

    const down = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        e.defaultPrevented || e.isComposing || e.repeat || !target ||
        target.isContentEditable ||
        target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]')
      ) {
        lastKeyString = "";
        return;
      }

      // Open Command Palette (Ctrl+K / Cmd+K)
      // Logic moved to provider
      /* 
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
        return;
      } 
      */

      // Toggle Sidebar ( [ )
      if (e.key === "[" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Toggle Theme (Alt + T)
      if (e.key.toLowerCase() === "t" && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setTheme(theme === "dark" ? "light" : "dark");
        return;
      }

      // "G then ..." Navigation Logic
      if (e.altKey || e.ctrlKey || e.metaKey) { lastKeyString = ""; return; }
      const currentTime = Date.now();
      const key = e.key.toLowerCase();

      if (lastKeyString === "g" && currentTime - lastKeyTime < 1000) {
        // Handle second key press within 1 second of 'g'
        const shortcuts: Record<string, string> = {
          a: "/accounts",
          b: "/budget",
          d: "/", // Dashboard
          g: "/goals",
          i: "/investments",
          c: "/recurring", // Calendar/Recurring
          r: "/reports",
          t: "/transactions",
          f: "/cash-flow",
        };

        if (shortcuts[key]) {
          e.preventDefault();
          setLocation(shortcuts[key]);
          lastKeyString = ""; // Reset
        }
      } else if (key === "g") {
        lastKeyString = "g";
        lastKeyTime = currentTime;
        return;
      }
    };

    // Need a variable outside the closure/effect scope? No, ref is better for state tracking in event listener
    // But modifying local var inside effect works if listener is not re-bound.
    // We'll use a local var in the scope of the effect? No, listener needs to persist.
    // Let's use a mutable variable in the effect scope.
    let lastKeyString = "";

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setLocation, setTheme, theme, toggleSidebar]);

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
    runCommand(() => {});
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search or type a command..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {/* Exact Monarch Order & Shortcuts */}
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/accounts"))}
          >
            <Wallet className="mr-2 h-4 w-4" />
            Go to Accounts
            <CommandShortcut>G then A</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/budget"))}
          >
            <DollarSign className="mr-2 h-4 w-4" />
            Go to Budget
            <CommandShortcut>G then B</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setLocation("/"))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Go to Dashboard
            <CommandShortcut>G then D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setLocation("/goals"))}>
            <Target className="mr-2 h-4 w-4" />
            Go to Goals
            <CommandShortcut>G then G</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/investments"))}
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            Go to Investments
            <CommandShortcut>G then I</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/recurring"))}
          >
            <Repeat className="mr-2 h-4 w-4" />
            Go to Recurring
            <CommandShortcut>G then C</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/reports"))}
          >
            <FileText className="mr-2 h-4 w-4" />
            Go to Reports
            <CommandShortcut>G then R</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/transactions"))}
          >
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Go to Transactions
            <CommandShortcut>G then T</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/cash-flow"))}
          >
            <PieChart className="mr-2 h-4 w-4" />
            Go to Cash Flow
            <CommandShortcut>G then F</CommandShortcut>
          </CommandItem>

          {/* Extras */}
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/receipts"))}
          >
            <Receipt className="mr-2 h-4 w-4" />
            Go to Receipts
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {accounts && accounts.length > 0 && (
          <>
            <CommandGroup heading="Accounts">
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  onSelect={() =>
                    runCommand(() => setLocation(`/accounts/${account.id}`))
                  }
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  {account.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {categories && categories.length > 0 && (
          <>
            <CommandGroup heading="Categories">
              {categories.slice(0, 10).map((category) => (
                <CommandItem
                  key={category.id}
                  onSelect={() =>
                    runCommand(() =>
                      setLocation(buildTransactionsUrl({ categoryId: category.id })),
                    )
                  }
                >
                  <Tag className="mr-2 h-4 w-4" />
                  {category.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {filterPresets && filterPresets.length > 0 && (
          <>
            <CommandGroup heading="Saved Filters">
              {filterPresets.map((preset) => (
                <CommandItem
                  key={preset.id}
                  onSelect={() =>
                    runCommand(() => {
                      // Navigate via the shared URL contract (R8). The preset's
                      // JSON is read with the same parser the page uses (R11),
                      // so dates and invalid values round-trip safely.
                      setLocation(buildTransactionsUrl(presetToTransactionFilters(preset.filters)));
                    })
                  }
                >
                  <Bookmark className="mr-2 h-4 w-4" />
                  {preset.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Settings">
          <CommandItem onSelect={() => runCommand(() => toggleSidebar())}>
            <PanelLeft className="mr-2 h-4 w-4" />
            Toggle left navigation
            <CommandShortcut>[</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => toggleTheme()}>
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Toggle theme
            <CommandShortcut>ALT T</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => setLocation("/settings"))}
          >
            <Settings className="mr-2 h-4 w-4" />
            Go to Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
