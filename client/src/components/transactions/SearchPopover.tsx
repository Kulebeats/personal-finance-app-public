import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SearchPopoverProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SearchPopover({ value, onChange, className }: SearchPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  // Sync draft with external value when popover opens
  useEffect(() => {
    if (open) {
      setDraftValue(value);
    }
  }, [open, value]);

  const handleApply = () => {
    onChange(draftValue);
    setOpen(false);
  };

  const handleCancel = () => {
    setDraftValue(value);
    setOpen(false);
  };

  const handleClear = () => {
    setDraftValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  const hasAppliedSearch = value.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2",
            hasAppliedSearch && "border-orange-500 text-orange-600",
            className
          )}
        >
          <Search className="h-4 w-4" />
          Search
          {hasAppliedSearch && (
            <span className="ml-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-xs text-orange-600">
              1
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Search</h4>
            <p className="text-sm text-muted-foreground">
              We'll match your search term to merchant names, categories, original statements, amounts, and notes.
            </p>
          </div>

          <div className="relative">
            <Input
              placeholder="Enter a search term..."
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pr-8"
              autoFocus
            />
            {draftValue && (
              <button
                type="button"
                onClick={() => setDraftValue("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={!draftValue}
            >
              Clear
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleApply}
                className="bg-orange-500 hover:bg-orange-600"
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
