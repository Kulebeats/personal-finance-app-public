/**
 * AH-03: reads an authentication link out of a message the SMTP sink captured.
 *
 * nodemailer may send each MIME part as 7bit, quoted-printable or base64, so
 * every readable form of the message is searched: the raw text, its
 * quoted-printable decoding, and each base64 block decoded. HTML entities
 * from the HTML part are undone. Every link found must be the same one, so a
 * message that offered two different links fails instead of picking one.
 */
export type AuthLinkPath = "/verify-email" | "/reset-password";

const BASE64_BLOCK = /(?:^|\r?\n)((?:[A-Za-z0-9+/]{4,}\r?\n)*[A-Za-z0-9+/]+={0,2})(?=\r?\n|$)/g;
const MIN_BASE64_LENGTH = 16;

function decodeQuotedPrintable(text: string): string {
  return text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64Blocks(text: string): string[] {
  return [...text.matchAll(BASE64_BLOCK)]
    .map((match) => match[1].replace(/\r?\n/g, ""))
    .filter((block) => block.length >= MIN_BASE64_LENGTH)
    .map((block) => Buffer.from(block, "base64").toString("utf8"));
}

const unescapeHtml = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The one `${origin}${path}?token=…` link in the message, as a URL. */
export function extractAuthLink(raw: string, origin: string, path: AuthLinkPath): URL {
  const prefix = `${origin}${path}?token=`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const pattern = new RegExp(`${prefix}[A-Za-z0-9_-]+`, "g");
  const readable = [raw, decodeQuotedPrintable(raw), ...decodeBase64Blocks(raw)].map(unescapeHtml);
  const links = new Set(readable.flatMap((text) => text.match(pattern) ?? []));
  if (links.size !== 1) throw new Error(`Expected exactly one ${path} link in the message, found ${links.size}`);
  return new URL([...links][0]);
}
