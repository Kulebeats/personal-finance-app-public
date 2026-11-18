/**
 * Return-path validation for post-login redirects (`/login?next=...`).
 *
 * Only a same-origin relative path is accepted, so a crafted link cannot
 * turn sign-in into an open redirect: protocol-relative URLs (`//host`),
 * absolute URLs, backslash tricks (`/\host`) and embedded whitespace or
 * control characters are all rejected.
 */

const MAX_RETURN_PATH_LENGTH = 2048;
const RETURN_PATH_PARAM = "next";
const DEFAULT_RETURN_PATH = "/";
// Placeholder origin used only to resolve the path; never navigated to.
const RESOLVE_BASE = "https://return-path.invalid";
// Whitespace, ASCII control characters and backslashes.
const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f\\]/;

export function getSafeReturnPath(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (UNSAFE_CHARACTERS.test(raw)) return null;

  try {
    const resolved = new URL(raw, RESOLVE_BASE);
    if (resolved.origin !== RESOLVE_BASE) return null;
  } catch {
    return null;
  }
  return raw;
}

/** Read and validate the `next` parameter from a query string. */
export function readReturnPath(
  search: string,
  fallback: string = DEFAULT_RETURN_PATH,
): string {
  const raw = new URLSearchParams(search).get(RETURN_PATH_PARAM);
  return getSafeReturnPath(raw) ?? fallback;
}

/** Build a `/login` href that comes back to `returnPath` afterwards. */
export function buildLoginHref(
  returnPath: string,
  mode?: "register",
): string {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  params.set(RETURN_PATH_PARAM, returnPath);
  return `/login?${params.toString()}`;
}
