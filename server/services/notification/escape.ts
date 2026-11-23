/**
 * The one place user-controlled strings are made safe for e-mail HTML (OPS-009).
 * Every notification e-mail template interpolates through this; nothing is trusted as HTML.
 * Push payloads are plain text (the browser renders them as text), so they are not escaped.
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
