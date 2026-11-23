/** Authentication emails use registered root routes on a configured public origin. */
export function publicAuthOrigin(configured: string | undefined, production: boolean): URL {
  let origin: URL;
  try {
    if (production && !configured?.trim()) throw new Error();
    origin = new URL(configured || "http://localhost:5000");
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      (production && origin.protocol !== "https:") ||
      origin.username || origin.password || origin.pathname !== "/" ||
      origin.search || origin.hash
    ) throw new Error();
  } catch {
    // Configuration may contain credentials; never include its value in errors.
    throw new Error("Invalid public application origin");
  }
  return origin;
}

export function buildPublicAuthLink(
  path: "/verify-email" | "/reset-password",
  token: string,
): string {
  const link = new URL(path, publicAuthOrigin(process.env.APP_URL, process.env.NODE_ENV === "production"));
  link.searchParams.set("token", token);
  return link.href;
}
