import { useState, useEffect, useCallback, useRef } from "react";
import { useUpdateProfile } from "./use-settings";
import { toast } from "sonner";

export interface AutoSaveState {
  status: "idle" | "saving" | "saved" | "error";
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
}

export interface ChangeHistoryEntry {
  id: string;
  timestamp: Date;
  changes: Record<string, any>;
  description: string;
}

export interface UseAutoSaveOptions {
  debounceMs?: number;
  maxHistorySize?: number;
  onSave?: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
}

export function useAutoSave<T extends Record<string, any>>(
  data: T,
  options: UseAutoSaveOptions = {}
) {
  const { debounceMs = 2000, maxHistorySize = 10, onSave, onError } = options;

  const updateProfile = useUpdateProfile();
  const [state, setState] = useState<AutoSaveState>({
    status: "idle",
    lastSaved: null,
    hasUnsavedChanges: false,
  });

  const [history, setHistory] = useState<ChangeHistoryEntry[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [initialData, setInitialData] = useState<T>(data);
  const previousDataRef = useRef<T>(data);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onSaveRef = useRef(onSave);
  const onErrorRef = useRef(onError);

  // Keep the latest callbacks without re-creating debouncedSave on every render
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Debounced save function
  const debouncedSave = useCallback(
    (dataToSave: T) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, status: "saving" }));

        // Create change entry for history
        const changes = getChanges(previousDataRef.current, dataToSave);
        if (Object.keys(changes).length > 0) {
          const changeEntry: ChangeHistoryEntry = {
            id: Date.now().toString(),
            timestamp: new Date(),
            changes,
            description: generateChangeDescription(changes),
          };

          setHistory((prev) => {
            const newHistory = [...prev, changeEntry].slice(-maxHistorySize);
            setCurrentHistoryIndex(newHistory.length - 1);
            return newHistory;
          });
        }

        updateProfile.mutate(dataToSave, {
          onSuccess: () => {
            setState({
              status: "saved",
              lastSaved: new Date(),
              hasUnsavedChanges: false,
            });
            // mark current data as the new baseline to avoid repeated save loops
            setInitialData(dataToSave);
            previousDataRef.current = dataToSave;
            onSaveRef.current?.(dataToSave);

            // Show saved indicator briefly
            setTimeout(() => {
              setState((prev) => ({ ...prev, status: "idle" }));
            }, 2000);
          },
          onError: (error) => {
            setState((prev) => ({ ...prev, status: "error" }));
            onErrorRef.current?.(error as Error);
            toast.error("Failed to save profile changes");

            // Reset to error state after 3 seconds
            setTimeout(() => {
              setState((prev) => ({ ...prev, status: "idle" }));
            }, 3000);
          },
        });
      }, debounceMs);
    },
    [debounceMs, maxHistorySize, updateProfile]
  );

  // Auto-save when data changes
  useEffect(() => {
    const hasChanges = hasDataChanged(initialData, data);
    setState((prev) => ({ ...prev, hasUnsavedChanges: hasChanges }));

    if (hasChanges) {
      debouncedSave(data);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, initialData, debouncedSave]);

  // Undo function
  const undo = useCallback(() => {
    if (history.length === 0 || currentHistoryIndex < 0) return null;

    const targetIndex = currentHistoryIndex - 1;
    setCurrentHistoryIndex(targetIndex);

    if (targetIndex === -1) {
      return initialData;
    }
    return applyChangesToData(initialData, history.slice(0, targetIndex + 1));
  }, [history, currentHistoryIndex, initialData]);

  // Redo function
  const redo = useCallback(() => {
    if (history.length === 0 || currentHistoryIndex >= history.length - 1) {
      return null;
    }

    const targetIndex = currentHistoryIndex + 1;
    setCurrentHistoryIndex(targetIndex);
    return applyChangesToData(initialData, history.slice(0, targetIndex + 1));
  }, [history, currentHistoryIndex, initialData]);

  // Manual save function
  const save = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    debouncedSave(data);
  }, [data, debouncedSave]);

  // Reset function
  const reset = useCallback(() => {
    setHistory([]);
    setCurrentHistoryIndex(-1);
    setInitialData(data);
    previousDataRef.current = data;
    setState({
      status: "idle",
      lastSaved: null,
      hasUnsavedChanges: false,
    });
  }, [data]);

  return {
    state,
    history,
    currentHistoryIndex,
    canUndo: currentHistoryIndex > -1,
    canRedo: currentHistoryIndex < history.length - 1,
    undo,
    redo,
    save,
    reset,
  };
}

// Helper functions
function hasDataChanged<T>(initial: T, current: T): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

function getChanges<T extends Record<string, any>>(
  previous: T,
  current: T
): Record<string, any> {
  const changes: Record<string, any> = {};

  for (const key in current) {
    if (current[key] !== previous[key]) {
      changes[key] = {
        from: previous[key],
        to: current[key],
      };
    }
  }

  return changes;
}

function generateChangeDescription(changes: Record<string, any>): string {
  const fieldNames = Object.keys(changes);

  if (fieldNames.length === 1) {
    const field = fieldNames[0];
    const fieldLabel = field.replace(/([A-Z])/g, " $1").toLowerCase();
    return `Updated ${fieldLabel}`;
  } else if (fieldNames.length <= 3) {
    const labels = fieldNames.map((f) =>
      f.replace(/([A-Z])/g, " $1").toLowerCase()
    );
    return `Updated ${labels.join(", ")}`;
  } else {
    return `Updated ${fieldNames.length} fields`;
  }
}

function applyChangesToData<T extends Record<string, any>>(
  initialData: T,
  historyEntries: ChangeHistoryEntry[]
): T {
  let result = { ...initialData };

  for (const entry of historyEntries) {
    for (const [field, change] of Object.entries(entry.changes)) {
      result[field as keyof T] = change.to;
    }
  }

  return result;
}
