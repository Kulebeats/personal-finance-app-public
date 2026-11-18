import React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FormFieldProps } from "../types/settings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

/**
 * FormField - A standardized form field wrapper
 *
 * Provides consistent styling for form fields with:
 * - Label with optional required indicator
 * - Error message display with proper accessibility
 * - Optional hint text
 * - Proper aria attributes for screen readers
 *
 * @example
 * <FormField
 *   label="Email"
 *   required
 *   error={errors.email?.message}
 *   hint="We'll never share your email"
 *   htmlFor="email"
 * >
 *   <Input id="email" {...register('email')} />
 * </FormField>
 */
export function FormField({
  label,
  required = false,
  error,
  hint,
  children,
  htmlFor,
  className,
  tooltip,
}: FormFieldProps & { className?: string; tooltip?: React.ReactNode }) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;

  return (
    <div
      className={cn(
        "space-y-2 transition-all duration-200 ease-out group/formfield",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Label
          htmlFor={htmlFor}
          className={cn("text-sm font-medium", error && "text-destructive")}
        >
          {label}
          {required && (
            <span className="text-destructive ml-1" aria-hidden="true">
              *
            </span>
          )}
        </Label>

        {tooltip && (
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "w-4 h-4 rounded-full border border-blue-200 text-blue-400 flex items-center justify-center cursor-help transition-opacity duration-300",
                    "opacity-0 pointer-events-none",
                    "group-hover/formfield:opacity-100 group-hover/formfield:pointer-events-auto"
                  )}
                >
                  <Info className="w-2.5 h-2.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="max-w-[300px] bg-blue-50 text-blue-900 border-blue-200"
              >
                <p>{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div
        aria-describedby={
          cn(error && errorId, hint && !error && hintId) || undefined
        }
        className={cn(
          "transition-shadow duration-200",
          "group-hover/formfield:shadow-[0_4px_20px_hsla(223.58,50.96%,59.22%,0.2)] group-hover/formfield:rounded-md"
        )}
      >
        {children}
      </div>

      {error && (
        <p
          id={errorId}
          className="text-sm text-destructive"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      )}

      {hint && !error && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

// Export for testing
