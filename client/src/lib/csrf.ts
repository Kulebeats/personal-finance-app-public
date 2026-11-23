/**
 * Shared CSRF token cache
 *
 * The server enforces double-submit CSRF (csrf-csrf) on every mutating route,
 * so BOTH client HTTP layers — apiCall (lib/api.ts) and apiRequest
 * (lib/queryClient.ts) — must attach x-csrf-token on POST/PUT/PATCH/DELETE.
 * This module is the single source of truth for acquiring, caching, and
 * clearing that token so the two layers cannot drift apart again.
 */

// CSRF token cache to avoid fetching for every request
let cachedCsrfToken: string | null = null;
let generation = 0;

// Fetch CSRF token (cached for efficiency)
export async function getCsrfToken(): Promise<string> {
  if (!cachedCsrfToken) {
    const requestGeneration = generation;
    const response = await fetch("/api/csrf-token", { credentials: "include" });
    if (!response.ok) throw new Error(`Unable to prepare request (${response.status})`);
    const data = await response.json();
    if (typeof data.csrfToken !== "string") throw new Error("Invalid CSRF token response");
    if (requestGeneration === generation) cachedCsrfToken = data.csrfToken;
    return data.csrfToken;
  }
  return cachedCsrfToken!;
}

// Clear cached CSRF token (call after logout or on 403)
export function clearCsrfToken(): void {
  generation++;
  cachedCsrfToken = null;
}
