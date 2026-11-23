/**
 * ReportHeader Component
 *
 * Header with tabs, year selector, customize and export dropdowns
 */

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, Table, Settings, LayoutGrid } from "lucide-react";
import { REPORT_TABS, AGGREGATION_OPTIONS } from "../constants";
import { ReportTab } from "../types";
import { AggregationLevel } from "@/components/reports/AggregationFilter";

interface ReportHeaderProps {
  activeTab: ReportTab;
  onTabChange: (tab: ReportTab) => void;
  year: number;
  onYearChange: (year: string) => void;
  availableYears: number[];
  aggregation: AggregationLevel;
  onAggregationChange: (level: AggregationLevel) => void;
  onExport: () => void;
  showExportHistory: boolean;
  onToggleExportHistory: () => void;
  onOpenCustomize?: () => void;
  lastUpdated?: string;
}

export function ReportHeader({
  activeTab,
  onTabChange,
  year,
  onYearChange,
  availableYears,
  aggregation,
  onAggregationChange,
  onExport,
  showExportHistory,
  onToggleExportHistory,
  onOpenCustomize,
  lastUpdated,
}: ReportHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
      {/* min-w-0: the title-and-tabs group may shrink, so the tab strip scrolls instead of widening the page. */}
      <div className="flex min-w-0 items-center gap-6">
        <div className="shrink-0">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Reports
          </h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-1">
              Last updated: {new Date(lastUpdated).toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Pill Tabs */}
        <div className="flex min-w-0 gap-2 overflow-x-auto no-scrollbar py-1">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id as ReportTab)}
              aria-label={`${tab.label} report tab`}
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={cn(
                "px-4 py-1.5 max-md:min-h-11 rounded-full text-sm font-medium transition-all whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-orange-500 dark:bg-orange-600 text-white shadow-sm hover:bg-orange-600 dark:hover:bg-orange-700"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Customize Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Customize report settings"
              className="h-9 max-md:h-11 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
            >
              <Settings className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              Customize
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>View Settings</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Year Selection */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="mr-2">Year:</span>
                <span className="font-medium">{year}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={String(year)}
                  onValueChange={onYearChange}
                >
                  {availableYears.map((y) => (
                    <DropdownMenuRadioItem key={y} value={String(y)}>
                      {y}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Aggregation Selection */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="mr-2">Period:</span>
                <span className="font-medium capitalize">{aggregation}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={aggregation}
                  onValueChange={(v) =>
                    onAggregationChange(v as AggregationLevel)
                  }
                >
                  {AGGREGATION_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {activeTab === "annual" && onOpenCustomize && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpenCustomize}>
                  <LayoutGrid className="w-4 h-4 mr-2" aria-hidden="true" />
                  Edit Dashboard Widgets
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Export report options"
              className="h-9 max-md:h-11 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              Export
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Export Options</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExport}>
              <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
              Export Current View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleExportHistory}>
              <Table className="w-4 h-4 mr-2" aria-hidden="true" />
              {showExportHistory ? "Hide History" : "View Export History"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
