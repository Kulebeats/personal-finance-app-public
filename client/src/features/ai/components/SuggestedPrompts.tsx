/**
 * SuggestedPrompts — tappable starter chips shown while the conversation is
 * empty (spec UI-AI-003e). Each prompt maps to a shipped analytics tool.
 */
import { Button } from "@/components/ui/button";

const SUGGESTED_PROMPTS = [
  "How is my budget this month?",
  "What are my top spending categories?",
  "What bills are coming up?",
  "How are my savings goals doing?",
];

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
  disabled: boolean;
}

export function SuggestedPrompts({ onSelect, disabled }: SuggestedPromptsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTED_PROMPTS.map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className="rounded-full"
        >
          {prompt}
        </Button>
      ))}
    </div>
  );
}
