/**
 * Transaction Search Component
 *
 * Search input with debouncing.
 */

import { useState, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TransactionSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}

export function TransactionSearch({
  value,
  onChange,
  placeholder = "Search transactions...",
  className,
  debounceMs = 300,
}: TransactionSearchProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounce the onChange callback
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [localValue, debounceMs, onChange, value]);

  const handleClear = useCallback(() => {
    setLocalValue("");
    onChange("");
  }, [onChange]);

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search transactions"
        className="pl-9 pr-8 max-md:pr-12 h-9 max-md:h-11"
        data-search-input
      />
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2 max-md:right-0 top-1/2 -translate-y-1/2 p-1 max-md:h-11 max-md:w-11 inline-flex items-center justify-center hover:bg-muted rounded"
        >
          <X className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
