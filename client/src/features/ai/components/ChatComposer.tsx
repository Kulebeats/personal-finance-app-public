/**
 * ChatComposer — the message input (spec UI-AI-003b, UI-AI-007b/c).
 *
 * Client-side mirror of the server's Zod rules: Send disabled when
 * empty/whitespace, hard cap 1000 chars with a live counter from 900.
 * Enter sends; Shift+Enter inserts a newline.
 */
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_MESSAGE_LENGTH = 1000;
const COUNTER_THRESHOLD = 900;
const MAX_VISIBLE_ROWS = 4;

interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled: boolean;
  isSending: boolean;
  /** Draft restored by the hook after a rejected send; consumed once. */
  restoredDraft: string | null;
  onDraftConsumed: () => void;
  validationError: string | null;
}

export function ChatComposer({
  onSend,
  disabled,
  isSending,
  restoredDraft,
  onDraftConsumed,
  validationError,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wasSendingRef = useRef(false);

  // Adopt a restored draft (rejected send) back into the composer.
  useEffect(() => {
    if (restoredDraft === null) return;
    setValue(restoredDraft);
    onDraftConsumed();
  }, [restoredDraft, onDraftConsumed]);

  // Return focus to the composer once a reply arrives (spec UI-AI-007c).
  useEffect(() => {
    if (wasSendingRef.current && !isSending && !disabled) {
      textareaRef.current?.focus();
    }
    wasSendingRef.current = isSending;
  }, [isSending, disabled]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isSending) return;
    onSend(trimmed);
    setValue("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const rows = Math.min(
    MAX_VISIBLE_ROWS,
    Math.max(1, value.split("\n").length),
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) =>
            setValue(event.target.value.slice(0, MAX_MESSAGE_LENGTH))
          }
          onKeyDown={handleKeyDown}
          rows={rows}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled || isSending}
          aria-label="Ask Thandi a question"
          aria-invalid={validationError !== null}
          placeholder="Ask Thandi a question…"
          className="min-h-0 flex-1 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || isSending || value.trim().length === 0}
          aria-label="Send"
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      <div className="flex min-h-4 items-center justify-between gap-2">
        {validationError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {validationError}
          </p>
        ) : (
          <span />
        )}
        {value.length >= COUNTER_THRESHOLD && (
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
          >{`${value.length}/${MAX_MESSAGE_LENGTH}`}</span>
        )}
      </div>
    </form>
  );
}
