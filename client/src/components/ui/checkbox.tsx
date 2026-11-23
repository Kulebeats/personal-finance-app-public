import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "group grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      // Below md the root is a 44 x 44 tap target with no box of its own; the span inside draws the same 16 px box (UX-02).
      "max-md:h-11 max-md:w-11 max-md:rounded-md max-md:border-0 max-md:shadow-none max-md:data-[state=checked]:bg-transparent",
      className
    )}
    {...props}
  >
    <span aria-hidden="true" className="contents max-md:grid max-md:h-4 max-md:w-4 max-md:place-content-center max-md:rounded-sm max-md:border max-md:border-primary max-md:shadow max-md:group-data-[state=checked]:bg-primary">
      <CheckboxPrimitive.Indicator
        className={cn("grid place-content-center text-current")}
      >
        <Check className="h-4 w-4" />
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
