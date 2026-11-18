/**
 * TagsMultiSelect Component
 *
 * Multi-select dropdown for selecting tags on transactions.
 * Supports inline tag creation and error states.
 * WCAG 2.1 AA compliant with proper aria-labels and error identification (3.3.1).
 */

import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TagBadge } from "./TagBadge";
import { TagModal } from "./TagModal";
import { useTags } from "@/hooks";
import type { Tag } from "@/lib/api";

interface TagsMultiSelectProps {
  value: string[];
  onChange: (tagIds: string[]) => void;
  allowCreate?: boolean;
  placeholder?: string;
  error?: string;
  className?: string;
}

export function TagsMultiSelect({
  value,
  onChange,
  allowCreate = true,
  placeholder = "Select tags...",
  error,
  className,
}: TagsMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { data: tags = [], isLoading } = useTags();
  const errorId = error ? "tags-multiselect-error" : undefined;

  // Get selected tags data
  const selectedTags = useMemo(() => {
    return value
      .map((id) => tags.find((t) => t.id === id))
      .filter((t): t is Tag => !!t);
  }, [value, tags]);

  const handleSelect = (tagId: string) => {
    if (value.includes(tagId)) {
      onChange(value.filter((id) => id !== tagId));
    } else {
      onChange([...value, tagId]);
    }
  };

  const handleRemove = (tagId: string) => {
    onChange(value.filter((id) => id !== tagId));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            role="combobox"
            tabIndex={0}
            aria-expanded={open}
            aria-label="Select tags to apply"
            aria-haspopup="listbox"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={errorId}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "cursor-pointer",
              "w-full justify-between min-h-[40px] h-auto",
              error && "border-destructive focus-visible:ring-destructive"
            )}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {selectedTags.length > 0 ? (
                selectedTags.map((tag) => (
                  <TagBadge
                    key={tag.id}
                    name={tag.name}
                    color={tag.color}
                    size="sm"
                    removable
                    onRemove={() => handleRemove(tag.id)}
                  />
                ))
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search tags..." />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Loading..." : "No tags found."}
              </CommandEmpty>
              <CommandGroup>
                {tags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => handleSelect(tag.id)}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: tag.color || "#A3A3A3" }}
                      />
                      <span>{tag.name}</span>
                    </div>
                    <Check
                      className={cn(
                        "h-4 w-4",
                        value.includes(tag.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              {allowCreate && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => {
                        setOpen(false);
                        setCreateModalOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create new tag
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Error Message (WCAG 3.3.1: Error Identification) */}
      {error && (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Create Tag Modal */}
      <TagModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        tag={null}
      />
    </div>
  );
}
