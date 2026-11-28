/**
 * Per-field validation errors for the sign-in and registration forms.
 *
 * On a 400 the server answers
 * `{ success: false, error: { code: "VALIDATION_ERROR", message, fields: [{ field, message, code }] } }`.
 * `apiCall` throws an Error carrying `fields`, but some callers receive the
 * envelope itself, so both shapes are read here.
 */

import { useCallback, useState } from "react";
import { INVALID_INPUT } from "@/lib/errorCopy";

export interface AuthFieldError {
  field: string;
  message: string;
  code?: string;
}

/** First-and-only message string per field name, ready to render. */
export type FieldMessages = Readonly<Record<string, string>>;

const NO_FIELD_MESSAGES: FieldMessages = Object.freeze({});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse an untrusted `fields` value, dropping entries that are not field errors. */
export function parseFieldErrors(value: unknown): AuthFieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AuthFieldError[] => {
    if (!isRecord(entry)) return [];
    const { field, message, code } = entry;
    if (typeof field !== "string" || typeof message !== "string" || !message) return [];
    return [{ field, message, ...(typeof code === "string" ? { code } : {}) }];
  });
}

/** Field errors from a thrown ApiError (`error.fields`) or a returned envelope (`error.error.fields`). */
export function readFieldErrors(source: unknown): AuthFieldError[] {
  if (!isRecord(source)) return [];
  const thrown = parseFieldErrors(source.fields);
  if (thrown.length > 0) return thrown;
  return isRecord(source.error) ? parseFieldErrors(source.error.fields) : [];
}

/** Spreadable `{ fieldErrors }` that is empty when the response carried none. */
export function withFieldErrors(source: unknown): { fieldErrors?: AuthFieldError[] } {
  const fieldErrors = readFieldErrors(source);
  return fieldErrors.length > 0 ? { fieldErrors } : {};
}

/** Join every message for a field, since a password can fail several rules at once. */
export function toFieldMessages(errors: readonly AuthFieldError[]): FieldMessages {
  return errors.reduce<FieldMessages>(
    (messages, { field, message }) => ({
      ...messages,
      [field]: messages[field] ? `${messages[field]} ${message}` : message,
    }),
    NO_FIELD_MESSAGES,
  );
}

/**
 * Toast text: a short pointer when every error has an input, otherwise fixed
 * plain copy. The server's message is never shown for a field with no input,
 * since nothing on screen explains it and it can carry internal detail.
 */
export function describeFieldErrors(
  errors: readonly AuthFieldError[],
  knownFields: readonly string[],
): string {
  const hasUnmatched = errors.some((error) => !knownFields.includes(error.field));
  return hasUnmatched ? INVALID_INPUT : "Please correct the highlighted fields.";
}

/** Props that tie an input to its error message (FormField renders `${id}-error`). */
export function fieldErrorProps(id: string, message: string | undefined, describedBy?: string) {
  const ids = [describedBy, message ? `${id}-error` : undefined].filter(Boolean).join(" ");
  return {
    "aria-invalid": message ? true : undefined,
    "aria-describedby": ids || undefined,
  } as const;
}

export function useFieldErrors() {
  const [messages, setMessages] = useState<FieldMessages>(NO_FIELD_MESSAGES);
  const set = useCallback(
    (errors: readonly AuthFieldError[]) => setMessages(toFieldMessages(errors)),
    [],
  );
  const reset = useCallback(() => setMessages(NO_FIELD_MESSAGES), []);
  /** Drop one field's message once the user edits that field. */
  const clear = useCallback(
    (field: string) =>
      setMessages((current) => {
        if (!(field in current)) return current;
        const { [field]: _removed, ...rest } = current;
        return rest;
      }),
    [],
  );
  return { messages, set, reset, clear };
}
