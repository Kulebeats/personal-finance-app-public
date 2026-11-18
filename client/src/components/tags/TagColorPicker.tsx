/**
 * TagColorPicker Component
 *
 * 12-color palette picker for tags (2 rows of 6 colors).
 * WCAG 2.1 AA compliant with roving tabindex and proper aria-labels.
 */

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

// 12-color palette matching Monarch with accessible names
export const TAG_COLORS = [
  "#EF4444", // Red
  "#F97316", // Orange
  "#EAB308", // Yellow
  "#22C55E", // Green
  "#14B8A6", // Teal
  "#06B6D4", // Cyan
  "#3B82F6", // Blue
  "#6366F1", // Indigo
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#F43F5E", // Rose
  "#A3A3A3", // Gray
] as const;

// Color names for aria-labels
const COLOR_NAMES: Record<string, string> = {
  "#EF4444": "Red",
  "#F97316": "Orange",
  "#EAB308": "Yellow",
  "#22C55E": "Green",
  "#14B8A6": "Teal",
  "#06B6D4": "Cyan",
  "#3B82F6": "Blue",
  "#6366F1": "Indigo",
  "#8B5CF6": "Purple",
  "#EC4899": "Pink",
  "#F43F5E": "Rose",
  "#A3A3A3": "Gray",
};

// Colors that need dark checkmark for contrast (WCAG 1.4.3)
const LIGHT_COLORS = ["#EAB308", "#06B6D4"];

interface TagColorPickerProps {
  value?: string | null;
  onChange: (color: string) => void;
  className?: string;
}

export function TagColorPicker({
  value,
  onChange,
  className,
}: TagColorPickerProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Handle keyboard navigation (roving tabindex pattern)
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const cols = 6; // colors per row
      let newIndex = index;

      switch (event.key) {
        case "ArrowRight":
          newIndex = (index + 1) % TAG_COLORS.length;
          event.preventDefault();
          break;
        case "ArrowLeft":
          newIndex = (index - 1 + TAG_COLORS.length) % TAG_COLORS.length;
          event.preventDefault();
          break;
        case "ArrowDown":
          newIndex = Math.min(index + cols, TAG_COLORS.length - 1);
          event.preventDefault();
          break;
        case "ArrowUp":
          newIndex = Math.max(index - cols, 0);
          event.preventDefault();
          break;
        case "Home":
          newIndex = 0;
          event.preventDefault();
          break;
        case "End":
          newIndex = TAG_COLORS.length - 1;
          event.preventDefault();
          break;
        default:
          return;
      }

      setFocusedIndex(newIndex);
      buttonRefs.current[newIndex]?.focus();
    },
    []
  );

  return (
    <div
      className={cn("grid grid-cols-6 gap-2", className)}
      role="radiogroup"
      aria-label="Select tag color"
    >
      {TAG_COLORS.map((color, index) => {
        const colorName = COLOR_NAMES[color] || "Color";
        const isSelected = value === color;
        const needsDarkCheck = LIGHT_COLORS.includes(color);

        return (
          <button
            key={color}
            ref={(el) => (buttonRefs.current[index] = el)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`Select ${colorName} color`}
            tabIndex={index === focusedIndex ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center transition-all",
              "hover:scale-110 hover:ring-2 hover:ring-offset-2 hover:ring-offset-background",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-primary",
              isSelected && "ring-2 ring-offset-2 ring-offset-background"
            )}
            style={{
              backgroundColor: color,
              ["--tw-ring-color" as string]: color,
            }}
          >
            {isSelected && (
              <Check
                className={cn(
                  "h-4 w-4 drop-shadow-sm",
                  needsDarkCheck ? "text-gray-900" : "text-white"
                )}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
