import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { RuleEditorModalProps } from "./types";
import { PreviewTab } from "./components/PreviewTab";
import { useRuleEditorState } from "./hooks/useRuleEditorState";
import { RuleEditorSettingsTab } from "./RuleEditorSettingsTab";

export function RuleEditorModal({
  open,
  onOpenChange,
  rule,
  onSave,
  categories,
  merchants,
  accounts,
  goals,
  members,
  isLoading = false,
}: RuleEditorModalProps) {
  const {
    activeTab,
    setActiveTab,
    name,
    setName,
    conditionLogic,
    setConditionLogic,
    conditions,
    actions,
    applyToPast,
    setApplyToPast,
    previewCount,
    isSaving,
    saveError,
    enabledConditions,
    enabledActions,
    previewMutation,
    updateCondition,
    addCondition,
    removeCondition,
    updateAction,
    addAction,
    removeAction,
    handleSave,
    enabled,
    setEnabled,
    priority,
    setPriority,
    hasUnsavedChanges,
  } = useRuleEditorState({ rule, open, onSave, onOpenChange });

  const [showConfirmClose, setShowConfirmClose] = React.useState(false);

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      onOpenChange(false);
    }
  };

  const handleConfirmClose = () => {
    setShowConfirmClose(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="text-lg font-semibold">
            {rule ? "Edit Rule" : "New Rule"}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col"
        >
          <TabsList className="mx-6 mt-2 w-fit">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="preview" className="gap-2">
              Preview changes
              {previewCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {previewCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="flex-1 overflow-hidden mt-0">
            <RuleEditorSettingsTab
              name={name}
              setName={setName}
              enabled={enabled}
              setEnabled={setEnabled}
              priority={priority}
              setPriority={setPriority}
              conditionLogic={conditionLogic}
              setConditionLogic={setConditionLogic}
              conditions={conditions}
              actions={actions}
              applyToPast={applyToPast}
              setApplyToPast={setApplyToPast}
              updateCondition={updateCondition}
              addCondition={addCondition}
              removeCondition={removeCondition}
              updateAction={updateAction}
              addAction={addAction}
              removeAction={removeAction}
              categories={categories}
              merchants={merchants}
              accounts={accounts}
              goals={goals}
              members={members}
            />
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="p-6">
                <PreviewTab
                  enabledConditions={enabledConditions}
                  previewMutation={previewMutation}
                  categories={categories}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <div className="space-y-1">
            {saveError ? (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            ) : null}
            <div className="text-sm text-muted-foreground">
              {enabledConditions.length} condition
              {enabledConditions.length !== 1 ? "s" : ""}, {enabledActions.length}{" "}
              action{enabledActions.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !name.trim() ||
                enabledConditions.length === 0 ||
                enabledActions.length === 0 ||
                isSaving
              }
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {rule ? "Save Changes" : "Create Rule"}
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showConfirmClose} onOpenChange={setShowConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close? Your
              changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
