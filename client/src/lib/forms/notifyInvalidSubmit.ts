import type { BaseSyntheticEvent } from "react";
import type { FieldValues, SubmitErrorHandler } from "react-hook-form";
import { toast } from "sonner";

/**
 * Second argument for react-hook-form's `handleSubmit`. When Save is pressed
 * on an invalid form it tells the user the form was not saved, names what
 * needs attention, and scrolls to and focuses the first invalid field
 * (react-hook-form cannot focus custom controls such as comboboxes).
 */

const MAX_NAMED_FIELDS = 4;
const FOCUSABLE_SELECTOR =
  "button, input, select, textarea, [tabindex]:not([tabindex='-1'])";

export type FieldLabels = Readonly<Record<string, string>>;

export interface InvalidField {
  path: string;
  message: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const LEAF_ERROR_KEYS = new Set(["type", "message", "ref", "types"]);

function isLeafError(node: Record<string, unknown>): boolean {
  return (
    typeof node.type === "string" &&
    Object.keys(node).every((key) => LEAF_ERROR_KEYS.has(key))
  );
}

/** Flattens react-hook-form's nested error object into dotted field paths. */
export function collectInvalidFields(
  errors: unknown,
  parentPath = "",
): InvalidField[] {
  if (!isRecord(errors)) return [];
  const fields: InvalidField[] = [];
  for (const [key, node] of Object.entries(errors)) {
    if (key === "ref" || !isRecord(node)) continue;
    const path = parentPath ? `${parentPath}.${key}` : key;
    if (isLeafError(node)) {
      fields.push({
        path,
        message: typeof node.message === "string" ? node.message : undefined,
      });
    } else {
      fields.push(...collectInvalidFields(node, path));
    }
  }
  return fields;
}

function describeField(field: InvalidField, labels?: FieldLabels): string {
  return labels?.[field.path] ?? field.message ?? field.path;
}

function quoteAttribute(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

function resolveRoot(event: BaseSyntheticEvent | undefined): ParentNode {
  const target = event?.target;
  if (target instanceof HTMLFormElement) return target;
  const active = document.activeElement;
  return active?.closest("form") ?? document;
}

function findInvalidElement(
  root: ParentNode,
  fields: InvalidField[],
): HTMLElement | null {
  const flagged = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (flagged) return flagged;
  for (const { path } of fields) {
    const quoted = quoteAttribute(path);
    const match = root.querySelector<HTMLElement>(
      `[name=${quoted}], [data-field=${quoted}]`,
    );
    if (match) return match;
  }
  return null;
}

function focusAndReveal(element: HTMLElement): void {
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const target = element.matches(FOCUSABLE_SELECTOR)
    ? element
    : element.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  target?.focus({ preventScroll: true });
}

function buildDescription(fields: InvalidField[], labels?: FieldLabels): string {
  const names = Array.from(
    new Set(fields.map((field) => describeField(field, labels))),
  );
  const shown = names.slice(0, MAX_NAMED_FIELDS).join(", ");
  const extra = names.length - MAX_NAMED_FIELDS;
  return extra > 0 ? `${shown} and ${extra} more` : shown;
}

// react-hook-form calls the invalid handler before React has re-rendered
// aria-invalid onto the fields, so look the field up after the next frame.
function afterNextRender(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
  } else {
    window.setTimeout(callback, 0);
  }
}

export function notifyInvalidSubmit<T extends FieldValues = FieldValues>(
  labels?: FieldLabels,
): SubmitErrorHandler<T> {
  return (errors, event) => {
    const fields = collectInvalidFields(errors);
    toast.error("Not saved. Please fix the highlighted fields.", {
      description: fields.length ? buildDescription(fields, labels) : undefined,
    });
    const root = resolveRoot(event);
    afterNextRender(() => {
      const element = findInvalidElement(root, fields);
      if (element) focusAndReveal(element);
    });
  };
}
