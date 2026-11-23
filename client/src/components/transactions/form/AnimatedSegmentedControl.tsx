import { cn } from "@/lib/utils";

export interface AnimatedSegmentedControlProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{
    value: string;
    label: string;
    color: string;
    disabled?: boolean;
  }>;
  disabled?: boolean;
}

export function AnimatedSegmentedControl({
  value,
  onChange,
  options,
  disabled,
}: AnimatedSegmentedControlProps) {
  return (
    <div className="relative inline-flex h-11 max-md:h-auto bg-muted/50 p-1 rounded-lg w-full">
      {options.map((option, index) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled || option.disabled}
            onClick={() => !option.disabled && onChange(option.value)}
            className={cn(
              "relative flex-1 rounded-md px-3 py-2 max-md:min-h-11 text-sm font-medium transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isActive
                ? cn(
                    "bg-background text-foreground shadow-sm",
                    option.color === "red" && "text-red-700",
                    option.color === "green" && "text-green-700",
                    option.color === "blue" && "text-blue-700"
                  )
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
