import React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "@/lib/utils";

const ContextCardRoot = HoverCardPrimitive.Root;
const ContextCardTriggerPrimitive = HoverCardPrimitive.Trigger;
const ContextCardContentPrimitive = HoverCardPrimitive.Content;

interface ContextCardTriggerProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof ContextCardTriggerPrimitive>,
    "content"
  > {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

const ContextCardTrigger = React.forwardRef<
  React.ElementRef<typeof ContextCardTriggerPrimitive>,
  ContextCardTriggerProps
>(
  (
    { children, content, side = "top", align = "center", className, ...props },
    ref
  ) => {
    return (
      <ContextCardRoot openDelay={200} closeDelay={100}>
        <ContextCardTriggerPrimitive
          ref={ref}
          className={className}
          {...props}
          asChild
        >
          {children}
        </ContextCardTriggerPrimitive>
        <ContextCardContentPrimitive
          side={side}
          align={align}
          sideOffset={5}
          className={cn(
            "z-50000 w-auto max-w-[320px] rounded-lg border-2 border-blue-500 bg-blue-100 p-0 text-popover-foreground shadow-[0_20px_40px_rgba(0,0,0,0.5)] outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          )}
        >
          {content}
        </ContextCardContentPrimitive>
      </ContextCardRoot>
    );
  }
);
ContextCardTrigger.displayName = "ContextCard.Trigger";

export const ContextCard = {
  Root: ContextCardRoot,
  Trigger: ContextCardTrigger,
};
