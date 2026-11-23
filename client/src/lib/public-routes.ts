const PUBLIC_ROUTES = new Set(["/login", "/verify-email", "/auth/verify-email", "/forgot-password", "/reset-password"]);
// Household invitation link (`/invite/<code>`): exactly one non-empty segment,
// so signed-out invitees can reach it; nothing deeper is public.
const PUBLIC_INVITE_ROUTE = /^\/invite\/[^/]+$/;

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname) || PUBLIC_INVITE_ROUTE.test(pathname);
}
