/**
 * Keyboard Shortcuts Hook
 *
 * Hook for handling keyboard shortcuts in the transactions page.
 *
 * @module features/transactions/hooks/useKeyboardShortcuts
 */

import { useEffect, useCallback } from "react";

interface KeyboardShortcutsConfig {
  onAddTransaction?: () => void;
  onSearch?: () => void;
  onExport?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onDelete?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

/**
 * Hook for handling keyboard shortcuts
 *
 * Shortcuts:
 * - `n` - New transaction
 * - `/` or `Ctrl+K` - Focus search
 * - `Ctrl+E` - Export to CSV
 * - `Ctrl+A` - Select all (when not in input)
 * - `Escape` - Clear selection / close modal
 * - `Delete` or `Backspace` - Delete selected
 */
export function useKeyboardShortcuts({
  onAddTransaction,
  onSearch,
  onExport,
  onSelectAll,
  onClearSelection,
  onDelete,
  onEscape,
  enabled = true,
}: KeyboardShortcutsConfig) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't handle shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Escape always works
      if (event.key === "Escape") {
        onEscape?.();
        return;
      }

      // These shortcuts only work outside inputs
      if (!isInput) {
        // n - New transaction
        if (event.key === "n" && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onAddTransaction?.();
          return;
        }

        // / - Focus search
        if (event.key === "/") {
          event.preventDefault();
          onSearch?.();
          return;
        }

        // Delete/Backspace - Delete selected
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onDelete?.();
          return;
        }
      }

      // Ctrl/Cmd shortcuts work everywhere except inputs
      if (event.ctrlKey || event.metaKey) {
        // Ctrl+K - Focus search
        if (event.key === "k" && !isInput) {
          event.preventDefault();
          onSearch?.();
          return;
        }

        // Ctrl+E - Export CSV
        if (event.key === "e") {
          event.preventDefault();
          onExport?.();
          return;
        }

        // Ctrl+A - Select all (only outside inputs)
        if (event.key === "a" && !isInput) {
          event.preventDefault();
          onSelectAll?.();
          return;
        }
      }
    },
    [
      enabled,
      onAddTransaction,
      onSearch,
      onExport,
      onSelectAll,
      onClearSelection,
      onDelete,
      onEscape,
    ],
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, enabled]);
}

/**
 * Component to display keyboard shortcuts help
 */
export const KEYBOARD_SHORTCUTS = [
  { key: "n", description: "New transaction" },
  { key: "/", description: "Focus search" },
  { key: "⌘K", description: "Focus search" },
  { key: "⌘E", description: "Export to CSV" },
  { key: "⌘A", description: "Select all" },
  { key: "Esc", description: "Clear selection / close" },
  { key: "Del", description: "Delete selected" },
] as const;
