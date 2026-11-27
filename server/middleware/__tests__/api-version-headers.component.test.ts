/**
 * NEW-33 (version-header part): the API has no /api/v1 alias, so no response may
 * announce a deprecation, a sunset date, or a /api/v1 successor link.
 *
 * Mounts the real `legacyApiRedirect` the way server/routes.ts does, on a bare app.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { legacyApiRedirect } from "../apiVersion";

function component() {
  const app = express();
  app.use("/api", legacyApiRedirect);
  app.all("/api/*", (_req, res) => res.json({ reachedHandler: true }));
  return app;
}

const paths = ["/api/accounts", "/api/transactions", "/api/auth/me"];

describe("API version headers (NEW-33)", () => {
  it.each(paths)("%s carries no Deprecation, Sunset or /api/v1 Link header", async (path) => {
    // Arrange
    const app = component();

    // Act
    const res = await request(app).get(path);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["deprecation"]).toBeUndefined();
    expect(res.headers["sunset"]).toBeUndefined();
    expect(res.headers["link"] ?? "").not.toContain("/api/v1");
    expect(res.headers["link"] ?? "").not.toContain("successor-version");
  });
});
