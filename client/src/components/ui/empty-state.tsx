/**
 * EmptyState Component
 *
 * A reusable wrapper component for empty states with CTA support.
 * Built on top of the existing empty primitives for consistent styling.
 *
 * Props:
 * - icon: React component for the icon (rendered with aria-hidden)
 * - title: Main heading text
 * - description: Explanatory text
 * - primaryAction: Primary CTA button config
 * - secondaryAction: Optional secondary CTA button config
 * - testId: Optional test identifier
 *
 * Accessibility:
 * - Icon is aria-hidden
 * - CTA labels are explicit
 * - Focus rings are visible
 */

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

export interface EmptyStateAction {
  label: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  variant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "destructive";
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  testId?: string;
  className?: string;
  /** Custom icon background color class, e.g. "bg-orange-500/10" */
  iconBgClassName?: string;
  /** Custom icon color class, e.g. "text-orange-600" */
  iconClassName?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  testId,
  className,
  iconBgClassName,
  iconClassName,
}: EmptyStateProps) {
  return (
    <Empty className={cn("py-16", className)} data-testid={testId}>
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(
            "w-12 h-12 rounded-full",
            iconBgClassName || "bg-primary/10",
          )}
        >
          <Icon
            className={cn("w-6 h-6", iconClassName || "text-primary")}
            aria-hidden="true"
          />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>

      {(primaryAction || secondaryAction) && (
        <EmptyContent>
          <div className="flex items-center gap-3">
            {primaryAction && (
              <Button
                onClick={primaryAction.onClick}
                variant={primaryAction.variant || "default"}
              >
                {primaryAction.icon && (
                  <primaryAction.icon
                    className="w-4 h-4 mr-2"
                    aria-hidden="true"
                  />
                )}
                {primaryAction.label}
              </Button>
            )}
            {secondaryAction && (
              <Button
                onClick={secondaryAction.onClick}
                variant={secondaryAction.variant || "outline"}
              >
                {secondaryAction.icon && (
                  <secondaryAction.icon
                    className="w-4 h-4 mr-2"
                    aria-hidden="true"
                  />
                )}
                {secondaryAction.label}
              </Button>
            )}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}

export default EmptyState;
