/**
 * AH-03: reads an authentication link out of a message the SMTP sink captured.
 *
 * The message is walked as MIME: each leaf part is decoded by its own
 * Content-Transfer-Encoding (7bit/8bit as sent, quoted-printable or base64),
 * and HTML entities are undone. Only decoded text is searched, so an encoded
 * artefact such as quoted-printable `token=3D…` can never be read as a link.
 * Every link found must be the same one, so a message offering two different
 * links fails instead of picking one.
 */
export type AuthLinkPath = "/verify-email" | "/reset-password";

interface Part { headers: string; body: string }

function splitPart(text: string): Part {
  const end = text.search(/\r?\n\r?\n/);
  if (end === -1) return { headers: text, body: "" };
  return { headers: text.slice(0, end), body: text.slice(end).replace(/^\r?\n\r?\n/, "") };
}

/** A header's value, with folded continuation lines joined. */
function header(headers: string, name: string): string {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const line = unfolded.split(/\r?\n/).find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : "";
}

function decodeQuotedPrintable(text: string): string {
  const bytes = text.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}

function decodeBody(part: Part): string {
  const encoding = header(part.headers, "Content-Transfer-Encoding").toLowerCase();
  if (encoding === "base64") return Buffer.from(part.body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(part.body);
  return part.body;
}

/** The decoded text of every leaf part of a MIME message. */
function decodedTexts(part: Part): string[] {
  const boundary = /boundary="?([^";]+)"?/i.exec(header(part.headers, "Content-Type"))?.[1];
  if (!boundary) return [decodeBody(part)];
  return part.body.split(`--${boundary}`).slice(1)
    .filter((section) => !section.startsWith("--"))
    .flatMap((section) => decodedTexts(splitPart(section.replace(/^\r?\n/, ""))));
}

const unescapeHtml = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The one `${origin}${path}?token=…` link in the message, as a URL. */
export function extractAuthLink(raw: string, origin: string, path: AuthLinkPath): URL {
  const prefix = `${origin}${path}?token=`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const pattern = new RegExp(`${prefix}[A-Za-z0-9_-]+`, "g");
  const links = new Set(decodedTexts(splitPart(raw)).map(unescapeHtml).flatMap((text) => text.match(pattern) ?? []));
  if (links.size !== 1) throw new Error(`Expected exactly one ${path} link in the message, found ${links.size}`);
  return new URL([...links][0]);
}
