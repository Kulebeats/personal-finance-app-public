import { test, expect, type Page } from "./protected-test";

/**
 * UX-01: signed-out public pages start no household queries, raise no error toast
 * and never show a raw JSON body. The invitation page is the one the
 * queryClient.ts fix names: its profile check answers 401 when signed out, and
 * that 401 must read as "signed out", not as a failed load.
 */
function recordApiRequests(page: Page) {
  const paths: string[] = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) paths.push(pathname);
  });
  return paths;
}

/** Session bootstrap, CSRF, and the invitation page's own signed-in check. */
const publicPaths = (path: string) =>
  path.startsWith("/api/auth/") || path === "/api/csrf-token" || path === "/api/settings/profile";

async function expectQuietPublicPage(page: Page, requests: readonly string[]) {
  await page.waitForLoadState("networkidle");
  expect(requests.filter(path => !publicPaths(path))).toEqual([]);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/"(success|error)"\s*:/);
}

test("a signed-out invitation link shows sign-in choices, not an error toast", async ({ page }) => {
  const requests = recordApiRequests(page);
  const profileStatuses: number[] = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/settings/profile") profileStatuses.push(response.status());
  });

  await page.goto("/invite/UX01-SYNTHETIC-CODE");
  await expect(page.getByRole("heading", { name: "You've been invited", exact: true })).toBeVisible();
  // The sign-in choices render only once the profile check has settled as signed out.
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toBeVisible();
  await expectQuietPublicPage(page, requests);
  expect(profileStatuses.every(status => status === 401)).toBe(true);
  await expect(page.getByText(/couldn't load|error loading data/i)).toHaveCount(0);

  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?.*mode=register/);
  await expect(page.getByText("Create Account", { exact: true }).first()).toBeVisible();
  await expectQuietPublicPage(page, requests);
});

test("the signed-out registration and reset pages start no household queries", async ({ page }) => {
  const requests = recordApiRequests(page);

  await page.goto("/login?mode=register");
  await expect(page.getByRole("button", { name: "Create Account", exact: true })).toBeVisible();
  await expectQuietPublicPage(page, requests);

  await page.goto("/register");
  await expectQuietPublicPage(page, requests);

  await page.goto("/reset-password");
  await expect(page.getByText("This reset link is missing its token.", { exact: true })).toBeVisible();
  await expectQuietPublicPage(page, requests);

  await page.goto("/reset-password?token=ux01-not-a-real-token");
  await expect(page.locator("#newPassword")).toBeVisible();
  await expectQuietPublicPage(page, requests);
});
