import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccountGroupProps {
  title: string;
  amount: number;
  isLiability?: boolean;
  onToggle?: () => void;
}

export function AccountGroup({
  title,
  amount,
  isLiability,
  onToggle,
}: AccountGroupProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle?.();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      aria-expanded={true}
      aria-label={`${title} account group, ${isLiability ? 'liability' : 'asset'} total ${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      className="flex items-center justify-between py-3 px-1 cursor-pointer group hover:bg-muted/30 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-center gap-2">
        <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-semibold text-foreground">{title}</span>
      </div>
      <div
        className={cn(
          "font-bold",
          isLiability ? "text-rose-600" : "text-foreground"
        )}
      >
        {isLiability && "-"}K
        {Math.abs(amount).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}
