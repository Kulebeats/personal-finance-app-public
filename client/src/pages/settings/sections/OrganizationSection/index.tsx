/**
 * OrganizationSection
 *
 * Combined settings section for transaction organization tools:
 * - Categories: Organize transactions by category
 * - Tags: Multi-label transactions with tags
 * - Rules: Automatic categorization rules
 */

import { Suspense, lazy, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import {
  ORGANIZATION_TABS,
  ORGANIZATION_TAB_LABELS,
  type OrganizationTab,
} from "@/features/settings/constants/sectionNames";
import { Tag, FolderTree, Zap } from "lucide-react";

// Lazy load tab content for better performance
const CategoriesContent = lazy(
  () => import("../CategoriesSection").then((m) => ({ default: m.default }))
);
const RulesContent = lazy(
  () => import("../RulesSection").then((m) => ({ default: m.default }))
);

// Tags tab uses the TagsList component directly
import { TagsList } from "@/components/tags";

const tabIcons = {
  [ORGANIZATION_TABS.CATEGORIES]: FolderTree,
  [ORGANIZATION_TABS.TAGS]: Tag,
  [ORGANIZATION_TABS.RULES]: Zap,
};

export default function OrganizationSection() {
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<OrganizationTab>(
    ORGANIZATION_TABS.CATEGORIES
  );

  // Parse tab from URL if present
  useEffect(() => {
    const match = location.match(/\/settings\/organization\/([^/]+)/);
    if (match) {
      const tab = match[1] as OrganizationTab;
      if (Object.values(ORGANIZATION_TABS).includes(tab)) {
        setActiveTab(tab);
        return;
      }
    }
    // Default to categories tab
    setActiveTab(ORGANIZATION_TABS.CATEGORIES);
  }, [location]);

  const handleTabChange = (tab: string) => {
    const newTab = tab as OrganizationTab;
    setActiveTab(newTab);
    setLocation(`/settings/organization/${newTab}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Organization</h2>
        <p className="text-muted-foreground">
          Manage how your transactions are organized and categorized.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          {Object.values(ORGANIZATION_TABS).map((tab) => {
            const Icon = tabIcons[tab];
            return (
              <TabsTrigger key={tab} value={tab} className="gap-2">
                <Icon className="h-4 w-4" />
                {ORGANIZATION_TAB_LABELS[tab]}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Categories Tab */}
        <TabsContent value={ORGANIZATION_TABS.CATEGORIES} className="mt-6">
          <ErrorBoundary sectionName="categories">
            <Suspense fallback={<LoadingSection variant="form" />}>
              <CategoriesContent />
            </Suspense>
          </ErrorBoundary>
        </TabsContent>

        {/* Tags Tab */}
        <TabsContent value={ORGANIZATION_TABS.TAGS} className="mt-6">
          <ErrorBoundary sectionName="tags">
            <TagsList />
          </ErrorBoundary>
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value={ORGANIZATION_TABS.RULES} className="mt-6">
          <ErrorBoundary sectionName="rules">
            <Suspense fallback={<LoadingSection variant="form" />}>
              <RulesContent />
            </Suspense>
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
