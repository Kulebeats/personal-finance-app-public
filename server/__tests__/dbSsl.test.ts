import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDatabaseSsl } from "../dbSsl";

const TEST_CA = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBtest",
  "-----END CERTIFICATE-----",
].join("\n");

const createdPaths: string[] = [];

afterEach(() => {
  for (const createdPath of createdPaths.splice(0)) {
    fs.rmSync(createdPath, { force: true, recursive: true });
  }
});
describe("resolveDatabaseSsl", () => {
  it("does not enable SSL in development unless explicitly requested", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("enables TLS in production while leaving cert verification staged off", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "production" })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("allows local production-mode smoke tests to disable database TLS explicitly", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL: "false",
      }),
    ).toBeUndefined();
  });

  it("uses an inline CA bundle when strict verification is enabled", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_CERT: TEST_CA.replace(/\n/g, "\\n"),
      }),
    ).toEqual({
      rejectUnauthorized: true,
      ca: TEST_CA,
    });
  });

  it("uses a mounted CA file when strict verification is enabled", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfa-db-ca-"));
    createdPaths.push(dir);
    const caFile = path.join(dir, "render-postgres-ca.pem");
    fs.writeFileSync(caFile, TEST_CA);

    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_FILE: caFile,
      }),
    ).toEqual({
      rejectUnauthorized: true,
      ca: TEST_CA,
    });
  });

  it("fails fast when a configured CA file cannot be read", () => {
    expect(() =>
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        DATABASE_SSL_CA_FILE: path.join(os.tmpdir(), "missing-ca.pem"),
      }),
    ).toThrow("DATABASE_SSL_CA_FILE could not be read");
  });
});
