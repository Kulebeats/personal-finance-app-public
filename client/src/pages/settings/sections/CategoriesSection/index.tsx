import { Suspense } from "react";
import { Loader2, Info } from "lucide-react";

import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { TypeSection } from "./TypeSection";
import { CategoryDialog } from "./components/CategoryDialog";
import { GroupDialog } from "./components/GroupDialog";
import { useCategoriesState } from "./hooks/useCategoriesState";

export default function CategoriesSection() {
  const {
    // Data
    categories,
    groups,
    categoriesByType,
    isLoading,
    hasCategories,
    isSeeding,
    showArchived,
    setShowArchived,

    // Dialog state
    isCategoryDialogOpen,
    setCategoryDialogOpen,
    isGroupDialogOpen,
    setGroupDialogOpen,
    editingCategory,
    editingGroup,

    // Form state
    categoryForm,
    setCategoryForm,
    groupForm,
    setGroupForm,

    // Actions
    openCreateCategory,
    openEditCategory,
    openCreateGroup,
    openEditGroup,
    handleSaveCategory,
    handleSaveGroup,
    handleCategoryDelete,
    handleCategoryRestore,
    handleDeleteGroup,
    handleRestoreGroup,
    handleReorderCategories,
    seedCategories,
  } = useCategoriesState();

  return (
    <ErrorBoundary sectionName="Categories">
      <Suspense fallback={<LoadingSection variant="list" />}>
        <SettingsCard
          title="Categories"
          description={undefined}
          isLoading={isLoading}
          action={
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2">
                {showArchived ? "Archived visible" : "Archived hidden"}
              </span>
              <Switch
                checked={showArchived}
                onCheckedChange={setShowArchived}
                aria-label="Show archived categories"
              />
            </div>
          }
        >
          {/* Info Banner */}
          <Alert className="mb-6 bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 text-cyan-900 dark:text-cyan-100">
            <Info className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
            <AlertDescription className="ml-2 text-cyan-800 dark:text-cyan-200 text-sm">
              Changes you make to your groups and categories here will be
              applied all throughout the app. You should customize your category
              structure to fit your needs.
            </AlertDescription>
          </Alert>

          {!hasCategories && !isLoading ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-muted-foreground">
                No categories found. Seed the default categories to get started.
              </p>
              <Button
                onClick={() => seedCategories()}
                disabled={isSeeding}
              >
                {isSeeding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Seeding...
                  </>
                ) : (
                  "Seed Default Categories"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <TypeSection
                type="income"
                groups={categoriesByType.income}
                categories={categories}
                onCreateGroup={openCreateGroup}
                onEditGroup={openEditGroup}
                onCreateCategory={openCreateCategory}
                onEditCategory={openEditCategory}
                onReorderCategories={handleReorderCategories}
                showArchived={showArchived}
              />

              <TypeSection
                type="expenses"
                groups={categoriesByType.expenses}
                categories={categories}
                onCreateGroup={openCreateGroup}
                onEditGroup={openEditGroup}
                onCreateCategory={openCreateCategory}
                onEditCategory={openEditCategory}
                onReorderCategories={handleReorderCategories}
                showArchived={showArchived}
              />

              <TypeSection
                type="transfers"
                groups={categoriesByType.transfers}
                categories={categories}
                onCreateGroup={openCreateGroup}
                onEditGroup={openEditGroup}
                onCreateCategory={openCreateCategory}
                onEditCategory={openEditCategory}
                onReorderCategories={handleReorderCategories}
                showArchived={showArchived}
              />
            </div>
          )}

          <CategoryDialog
            open={isCategoryDialogOpen}
            onOpenChange={setCategoryDialogOpen}
            formState={categoryForm}
            setFormState={setCategoryForm}
            onSubmit={handleSaveCategory}
            onDelete={handleCategoryDelete}
            onRestore={handleCategoryRestore}
            editingCategory={editingCategory}
            groups={groups}
          />

          <GroupDialog
            open={isGroupDialogOpen}
            onOpenChange={setGroupDialogOpen}
            formState={groupForm}
            setFormState={setGroupForm}
            onSubmit={handleSaveGroup}
            onDelete={handleDeleteGroup}
            onRestore={handleRestoreGroup}
            editingGroup={editingGroup}
          />
        </SettingsCard>
      </Suspense>
    </ErrorBoundary>
  );
}
