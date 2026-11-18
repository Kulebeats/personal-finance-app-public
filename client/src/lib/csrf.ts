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

// Fetch CSRF token (cached for efficiency)
export async function getCsrfToken(): Promise<string> {
  if (!cachedCsrfToken) {
    const response = await fetch("/api/csrf-token", { credentials: "include" });
    const data = await response.json();
    cachedCsrfToken = data.csrfToken;
  }
  return cachedCsrfToken!;
}

// Clear cached CSRF token (call after logout or on 403)
export function clearCsrfToken(): void {
  cachedCsrfToken = null;
}
