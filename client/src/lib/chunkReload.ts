/**
 * Stale lazy-chunk recovery.
 *
 * After a deploy, the hashed chunk files a still-open tab asks for are gone,
 * so `import()` rejects with "Failed to fetch dynamically imported module".
 * React caches that rejection, so the route boundary's Retry cannot recover.
 * Reloading picks up the new index.html and chunk names.
 *
 * The time of the last automatic reload is kept in sessionStorage, and the
 * page reloads again only once that is older than a cooldown. It is never
 * cleared on a successful page load: a page whose own chunk loads but whose
 * nested lazy chunk (a settings section, a dashboard widget) keeps failing
 * would otherwise reload forever.
 */
import { lazy } from "react";

type LazyPageFactory = Parameters<typeof lazy>[0];
type LazyPageModule = Awaited<ReturnType<LazyPageFactory>>;

export const CHUNK_RELOAD_AT_KEY = "pfa:stale-chunk-reload-at";

/**
 * Minimum gap between automatic reloads. A reload, the new index.html and the
 * failing chunk's retry complete in seconds even on a slow mobile link, so a
 * failure within a minute of the last reload means the reload did not help
 * (stop, or it loops). A failure later than that is most likely a newer deploy
 * in the same tab, which a fresh reload fixes.
 */
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return CHUNK_ERROR_PATTERN.test(message);
}

/** True when no automatic reload happened within the cooldown. False when storage is unreadable. */
function isOutsideCooldown(now: number): boolean {
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_AT_KEY);
    if (raw === null) return true;
    const lastReloadAt = Number.parseInt(raw, 10);
    if (Number.isNaN(lastReloadAt)) return true;
    const elapsed = now - lastReloadAt;
    // A negative gap means the clock moved back; don't let that block recovery.
    return elapsed < 0 || elapsed >= CHUNK_RELOAD_COOLDOWN_MS;
  } catch (error) {
    console.warn("Stale-chunk reload skipped: sessionStorage unreadable", error);
    return false;
  }
}

function recordReload(now: number): boolean {
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_AT_KEY, String(now));
    return true;
  } catch (error) {
    console.warn("Stale-chunk reload skipped: sessionStorage unwritable", error);
    return false;
  }
}

/** Reload for a stale chunk at most once per cooldown; returns whether it reloaded. */
export function reloadOnceForStaleChunk(
  reload: () => void = () => window.location.reload(),
): boolean {
  const now = Date.now();
  if (!isOutsideCooldown(now) || !recordReload(now)) return false;
  reload();
  return true;
}

/** Vite fires this when a chunk's preload (JS deps or CSS) fails. */
export function installStaleChunkReloadHandler(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForStaleChunk()) event.preventDefault();
  });
}

/** `React.lazy` that reloads (at most once per cooldown) on a stale chunk. */
export function lazyWithChunkReload(factory: LazyPageFactory) {
  return lazy(() =>
    factory().catch((error: unknown) => {
      if (isChunkLoadError(error) && reloadOnceForStaleChunk()) {
        // The page is reloading; keep Suspense showing the loader meanwhile.
        return new Promise<LazyPageModule>(() => {});
      }
      throw error;
    }),
  );
}
