import fs from "node:fs/promises";
import path from "node:path";
import { prepareTestEnvironment, verifyDatabaseTarget } from "./test-target.mjs";
import { installNetworkGuard } from "./network-guard.mjs";
import { installPostgresGuard } from "./postgres-guard.mjs";
import { applyProductionProfile, isProductionProfile } from "./production-profile";

const environment = prepareTestEnvironment();
if (environment.mode !== "database" || !environment.target?.server) {
  throw new Error("Browser tests require a manifest database and owned server origin");
}
installNetworkGuard(environment);
await installPostgresGuard(environment);
const target = await verifyDatabaseTarget();
const origin = new URL(target.server!.origin);
process.env.PORT = origin.port;
process.env.HOST = origin.hostname.replace(/^\[|\]$/g, "");
process.env.CLIENT_URL = origin.origin;
process.env.APP_URL = origin.origin;
// R20.3: leave test mode (CSRF and limiters live) before the application import.
const production = isProductionProfile() ? applyProductionProfile() : undefined;

// No application import occurs until both static intent and persisted identity pass.
const { default: runApp, app } = await import("../app");
app.get("/__test/identity", (_req, res) => {
  res.json({ runId: target.runId, database: target.database, origin: origin.origin });
});
if (production) {
  // Read live, so a spec sees the mode the running app is in, not the one it was started with.
  app.get("/__test/profile", (_req, res) => {
    res.json({ ...production, nodeEnv: process.env.NODE_ENV, trustProxy: String(app.get("trust proxy")) });
  });
}
await runApp(async (expressApp, server) => {
  if (process.env.TEST_BROWSER_CLIENT === "built") {
    const { default: express } = await import("express");
    const root = path.resolve(import.meta.dirname, "../../dist/public");
    const entry = path.join(root, "index.html");
    await fs.access(entry);
    expressApp.use(express.static(root));
    expressApp.get("*", (req, res, next) => {
      if (req.path === "/api" || req.path.startsWith("/api/") || req.path.startsWith("/assets/") ||
          !req.get("accept")?.includes("text/html")) return next();
      res.sendFile(entry);
    });
    return;
  }
  const { createServer } = await import("vite");
  const { default: viteConfig } = await import("../../vite.config");
  const vite = await createServer({ ...viteConfig, configFile: false, server: {
    middlewareMode: true, hmr: { server },
  }, appType: "custom" });
  expressApp.use(vite.middlewares);
  expressApp.use("*", async (req, res, next) => {
    if (req.originalUrl.startsWith("/api/")) return next();
    try {
      const template = await fs.readFile(path.resolve(import.meta.dirname, "../../client/index.html"), "utf8");
      res.status(200).type("html").send(await vite.transformIndexHtml(req.originalUrl, template));
    } catch (error) { next(error); }
  });
});
