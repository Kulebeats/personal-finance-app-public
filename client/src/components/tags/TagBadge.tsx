/**
 * TagBadge Component
 *
 * Displays a tag as a colored badge with optional remove button.
 * WCAG 2.1 AA compliant with proper aria-labels.
 */

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagBadgeProps {
  name: string;
  color?: string | null;
  size?: "sm" | "md";
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function TagBadge({
  name,
  color,
  size = "md",
  removable = false,
  onRemove,
  className,
}: TagBadgeProps) {
  const dotColor = color || "#A3A3A3"; // Default gray if no color

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-muted/50",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        removable && "pr-1",
        className
      )}
    >
      <span
        className={cn(
          "rounded-full",
          size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"
        )}
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      <span className="font-medium">{name}</span>
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${name} tag`}
          className="ml-0.5 rounded-full p-0.5 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        >
          <X
            className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")}
            aria-hidden="true"
          />
        </button>
      )}
    </span>
  );
}
