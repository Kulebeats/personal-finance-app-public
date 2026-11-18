import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Check,
  AlertCircle,
  Undo,
  Redo,
  Clock,
  History,
} from "lucide-react";
import { AutoSaveState, ChangeHistoryEntry } from "@/hooks/useAutoSave";
import { formatDistanceToNow } from "date-fns";

interface AutoSaveIndicatorProps {
  state: AutoSaveState;
  history: ChangeHistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onManualSave?: () => void;
}

export function AutoSaveIndicator({
  state,
  history,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onManualSave,
}: AutoSaveIndicatorProps) {
  const getStatusIcon = () => {
    switch (state.status) {
      case "saving":
        return <Loader2 className="h-3 w-3 animate-spin text-blue-500 dark:text-blue-400" />;
      case "saved":
        return <Check className="h-3 w-3 text-green-500 dark:text-green-400" />;
      case "error":
        return <AlertCircle className="h-3 w-3 text-red-500 dark:text-red-400" />;
      default:
        return state.hasUnsavedChanges ? (
          <Clock className="h-3 w-3 text-orange-500 dark:text-orange-400" />
        ) : (
          <Check className="h-3 w-3 text-gray-400 dark:text-gray-500" />
        );
    }
  };

  const getStatusText = () => {
    switch (state.status) {
      case "saving":
        return "Saving...";
      case "saved":
        return "Saved";
      case "error":
        return "Save failed";
      default:
        return state.hasUnsavedChanges
          ? "Unsaved changes"
          : "All changes saved";
    }
  };

  const getLastSavedText = () => {
    if (!state.lastSaved) return "Never saved";
    return `Last saved ${formatDistanceToNow(state.lastSaved, {
      addSuffix: true,
    })}`;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg border border-border shadow-sm backdrop-blur-sm">
      {/* Status Indicator */}
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <span className="text-xs font-medium text-muted-foreground">
          {getStatusText()}
        </span>
      </div>

      {/* Last Saved Time */}
      {state.lastSaved && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-help">
                •
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{getLastSavedText()}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Undo/Redo Buttons */}
      <div className="flex items-center gap-1 ml-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onUndo}
                disabled={!canUndo}
              >
                <Undo className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Undo last change</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onRedo}
                disabled={!canRedo}
              >
                <Redo className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Redo last undone change</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Change History */}
        {history.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <History className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-medium">Recent Changes:</p>
                  {history
                    .slice(-5)
                    .reverse()
                    .map((entry, index) => (
                      <div key={entry.id} className="text-xs">
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(entry.timestamp, {
                            addSuffix: true,
                          })}
                          :
                        </span>{" "}
                        {entry.description}
                      </div>
                    ))}
                  {history.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      ...and {history.length - 5} more changes
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Manual Save Button (for emergencies) */}
      {state.hasUnsavedChanges && onManualSave && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs ml-2"
          onClick={onManualSave}
          disabled={state.status === "saving"}
        >
          Save Now
        </Button>
      )}
    </div>
  );
}
