import type { KeyboardEventHandler } from "react";
import { Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface RuleTagSelectorProps {
  availableTags: ReadonlyArray<{ id: string; name: string }>;
  tagIds: string[];
  input: string;
  error: string;
  expanded: boolean;
  disabled: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onRemoveTag: (id: string) => void;
}

export function RuleTagSelector({
  availableTags, tagIds, input, error, expanded, disabled,
  onExpandedChange, onInputChange, onInputKeyDown, onRemoveTag,
}: RuleTagSelectorProps) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="rule-add-tags" className="font-medium">Add tags</Label>
        <Switch id="rule-add-tags" checked={expanded} disabled={disabled} onCheckedChange={onExpandedChange} />
      </div>
      {expanded && <>
        <div className="flex flex-wrap gap-2 p-2 border border-dashed rounded-md min-h-[40px]">
          {tagIds.map((id) => (
            <span key={id} className="bg-muted px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {availableTags.find((tag) => tag.id === id)?.name || "Unavailable tag"}
              <button type="button" disabled={disabled} aria-label={`Remove tag ${id}`} onClick={() => onRemoveTag(id)}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <Input
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={disabled}
            list="rule-existing-tags"
            aria-label="Existing tag name"
            aria-invalid={!!error}
            className="flex-1 min-w-[100px] h-7 border-0 shadow-none"
            placeholder="Type an existing tag..."
          />
          <datalist id="rule-existing-tags">
            {availableTags.map((tag) => <option key={tag.id} value={tag.name} />)}
          </datalist>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">Press Enter to select an existing tag. Create new tags in Settings first.</p>
      </>}
    </div>
  );
}
