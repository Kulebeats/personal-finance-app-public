/**
 * Merchant logo and alias routes over real HTTP against real Postgres.
 *
 * POST/DELETE /api/merchants/:id/logo and POST/DELETE
 * /api/merchants/:id/aliases[/:aliasId] were lost in the P4 cutover, so the
 * SPA fallback answered with HTML ("Unexpected token '<'"). These tests pin the
 * restored contract, household scoping, the role gate, the audit row, and the
 * logo upload boundary (content-typed, size-capped, SVG rasterised to PNG).
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  auditLogs,
  householdMembers,
  households,
  merchantAliases,
  merchantLogoUploads,
  merchants,
  users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { removeStoredUnder, storedBytes, storedNamesUnder } from "../../../__tests__/stored-upload-fixture";
import { merchantAssetsService } from "../merchants.assets.service";
import { LOGO_MAX_UPLOAD_BYTES, prepareLogoImage } from "../merchants.logo-image";
import { SVG_MAX_UPLOAD_BYTES } from "../merchants.svg-guard";

type Actor = "owner" | "viewOnly" | "outsider";

const householdA = randomUUID();
const householdB = randomUUID();
const merchantA = randomUUID();
const merchantB = randomUUID();
const otherMerchantA = randomUUID();
const foreignAliasId = randomUUID();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, string>();
const logoDirA = path.resolve(process.cwd(), "uploads", "merchant-logos", householdA);
const LOGO_URL_A = new RegExp(`^/uploads/merchant-logos/${householdA}/[0-9a-f-]{36}\\.png$`);
let app: Awaited<ReturnType<typeof getTestApp>>;

const withCookie = (test: request.Test, actor: Actor = "owner") => test.set("Cookie", cookies.get(actor)!);
const logoPost = (merchantId: string, actor: Actor = "owner") =>
  withCookie(request(app).post(`/api/merchants/${merchantId}/logo`), actor);

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 1 } } })
    .png()
    .toBuffer();
}

const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<script>alert("xss")</script><rect width="64" height="64" fill="#c00"/></svg>',
);

/** Plain vector SVG of the kind a logo export produces: defs, gradient, use. */
const VECTOR_SVG = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#c00"/></linearGradient>' +
    '<rect id="r" width="64" height="64"/></defs><use xlink:href="#r" fill="url(#g)"/></svg>',
);

function svg(inner: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${inner}</svg>`);
}

async function rowForUrl(logoUrl: string) {
  const rows = await db.select().from(merchantLogoUploads).where(eq(merchantLogoUploads.filePath, logoUrl.slice(1)));
  return rows[0];
}

/** Stored logo objects (OPS-001) plus anything left on the legacy disk folder. */
async function logoDirListing(): Promise<string[]> {
  const stored = await storedNamesUnder(`merchant-logos/${householdA}/`);
  try {
    return [...stored, ...(await fs.readdir(logoDirA))].sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return stored.sort();
    throw err;
  }
}

async function auditRows(entityId: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)).orderBy(auditLogs.createdAt);
}

async function logoRows(merchantId: string) {
  return db.select().from(merchantLogoUploads).where(eq(merchantLogoUploads.merchantId, merchantId));
}

async function addActor(
  actor: Actor,
  householdId: string,
  role: "owner" | "view_only",
  passwordHash: string,
  password: string,
) {
  const id = randomUUID();
  const email = `merchant-assets-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `merchant-assets-${id}`, passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  cookies.set(actor, (login.headers["set-cookie"] as unknown as string[]).join("; "));
  userIds.set(actor, id);
}

describe("merchant logo and alias routes (real DB, real HTTP)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([
      { id: householdA, name: "Synthetic merchant assets A", currency: "ZMW" },
      { id: householdB, name: "Synthetic merchant assets B", currency: "ZMW" },
    ]);
    const password = "SyntheticMerchantAssets123!";
    const passwordHash = await hashPassword(password);
    await addActor("owner", householdA, "owner", passwordHash, password);
    await addActor("viewOnly", householdA, "view_only", passwordHash, password);
    await addActor("outsider", householdB, "owner", passwordHash, password);
    await db.insert(merchants).values([
      { id: merchantA, householdId: householdA, name: "Synthetic Shoprite" },
      { id: otherMerchantA, householdId: householdA, name: "Synthetic Pick n Pay" },
      { id: merchantB, householdId: householdB, name: "Foreign merchant" },
    ]);
    await db.insert(merchantAliases).values({ id: foreignAliasId, merchantId: merchantB, aliasName: "FOREIGN ALIAS" });
  }, 30_000);

  afterAll(async () => {
    const ids = [...userIds.values()];
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, [householdA, householdB]));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(merchants).where(inArray(merchants.householdId, [householdA, householdB]));
    await db.delete(households).where(inArray(households.id, [householdA, householdB]));
    for (const id of ids) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
    await removeStoredUnder(`merchant-logos/${householdA}/`);
    await fs.rm(logoDirA, { recursive: true, force: true });
  });

  describe("POST /api/merchants/:id/logo", () => {
    it("stores a PNG as a server-encoded 512px PNG, serves it to the household only, and audits it", async () => {
      const res = await logoPost(merchantA).attach("logo", await pngBytes(), { filename: "logo.png", contentType: "image/png" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logoUrl).toMatch(LOGO_URL_A);
      expect(res.body.data.merchant).toMatchObject({ id: merchantA, logoUrl: res.body.data.logoUrl });
      const rows = await logoRows(merchantA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ mimeType: "image/png", originalFilename: "logo.png", uploadedBy: userIds.get("owner") });
      const stored = await sharp((await storedBytes(rows[0].filePath))!).metadata();
      expect(stored).toMatchObject({ format: "png", width: 512, height: 512 });

      const served = await withCookie(request(app).get(res.body.data.logoUrl));
      expect(served.status).toBe(200);
      expect(served.headers["content-type"]).toContain("image/png");
      const foreign = await withCookie(request(app).get(res.body.data.logoUrl), "outsider");
      expect(foreign.status).toBe(403);

      const audits = (await auditRows(merchantA)).filter((row) => row.action === "UPDATE");
      expect(audits.at(-1)).toMatchObject({ householdId: householdA, userId: userIds.get("owner"), entityType: "merchant" });
      expect(audits.at(-1)!.details).toMatchObject({ operation: "logo_upload", newValue: { logoUrl: res.body.data.logoUrl } });
    });

    it("rasterises an SVG to PNG so no user markup is ever stored or served, and keeps the replaced file", async () => {
      const [previous] = await logoRows(merchantA);
      const res = await logoPost(merchantA).attach("logo", SVG_WITH_SCRIPT, { filename: "shoprite.svg", contentType: "image/svg+xml" });

      expect(res.status).toBe(200);
      expect(res.body.data.logoUrl).toMatch(LOGO_URL_A);
      const current = await rowForUrl(res.body.data.logoUrl);
      expect(current).toMatchObject({ merchantId: merchantA, mimeType: "image/png" });
      const bytes = (await storedBytes(current.filePath))!;
      expect((await sharp(bytes).metadata()).format).toBe("png");
      expect(bytes.toString("latin1")).not.toContain("<script");
      const served = await withCookie(request(app).get(res.body.data.logoUrl));
      expect(served.headers["content-type"]).toContain("image/png");
      // A merge or edit may still show the replaced file, so it is never unlinked.
      expect(await storedBytes(previous.filePath)).not.toBeNull();
      expect(await logoRows(merchantA)).toHaveLength(2);
    });

    it.each([
      ["HTML disguised as a PNG", Buffer.from("<html><script>alert(1)</script></html>"), "logo.png", "image/png"],
      ["HTML disguised as an SVG", Buffer.from("<html><script>alert(1)</script></html>"), "logo.svg", "image/svg+xml"],
      ["a PNG declared as SVG", null, "logo.svg", "image/svg+xml"],
      ["a gzip-compressed SVG (SVGZ)", gzipSync(SVG_WITH_SCRIPT), "logo.svgz", "image/svg+xml"],
      ["a disallowed declared type", null, "logo.gif", "image/gif"],
    ])("refuses %s with 400 and writes nothing", async (_label, body, filename, contentType) => {
      const before = await logoRows(merchantA);
      const filesBefore = await logoDirListing();
      const res = await logoPost(merchantA).attach("logo", body ?? (await pngBytes()), { filename, contentType });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(await logoRows(merchantA)).toEqual(before);
      expect(await logoDirListing()).toEqual(filesBefore);
    });

    it("refuses a decompression bomb (pixel count over the decode limit) with 400", async () => {
      const bomb = await sharp({ create: { width: 4200, height: 4200, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      expect(bomb.length).toBeLessThan(LOGO_MAX_UPLOAD_BYTES);
      const filesBefore = await logoDirListing();
      const res = await logoPost(merchantA).attach("logo", bomb, { filename: "bomb.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(await logoDirListing()).toEqual(filesBefore);
    });

    it("removes the new file when the write transaction fails", async () => {
      const logo = await prepareLogoImage({ buffer: await pngBytes(), mimetype: "image/png" });
      const filesBefore = await logoDirListing();
      const actor = { householdId: householdA, userId: userIds.get("owner")! };

      await expect(merchantAssetsService.setLogo(merchantB, actor, logo, "x.png")).rejects.toMatchObject({ statusCode: 404 });
      expect(await logoDirListing()).toEqual(filesBefore);
    });

    it("does not serve legacy raw uploads left in the merchant-logos folder", async () => {
      await fs.mkdir(logoDirA, { recursive: true });
      for (const name of ["merchant-legacy-1.svg", "merchant-legacy-2.html", "merchant-legacy-3-512.png"]) {
        await fs.writeFile(path.join(logoDirA, name), "<svg><script>alert(1)</script></svg>");
        const res = await withCookie(request(app).get(`/uploads/merchant-logos/${householdA}/${name}`));
        expect.soft(res.status, name).toBe(403);
        await fs.rm(path.join(logoDirA, name));
      }
    });

    it("accepts a plain vector SVG with an XML declaration, a gradient and a #fragment use", async () => {
      const res = await logoPost(merchantA).attach("logo", VECTOR_SVG, { filename: "brand.svg", contentType: "image/svg+xml" });

      expect(res.status).toBe(200);
      expect(res.body.data.logoUrl).toMatch(LOGO_URL_A);
    });

    it.each([
      ["the comment bypass of a reference scan", async () => {
        const png = (await pngBytes()).toString("base64");
        return svg(`<!-- href="# --> <image width='64' height='64' href='data:image/png;base64,${png}'/> <!-- " -->`);
      }],
      ["any <image> element", async () => svg('<image width="16" height="16" href="#r"/>')],
      ["an feImage filter", async () => svg('<filter id="f"><feImage href="#r"/></filter>')],
      ["a data: URL", async () => svg('<rect filter="url(data:image/svg+xml,x)"/>')],
      ["base64 content", async () => svg("<desc>base64</desc>")],
      ["a comment", async () => svg("<!-- Generator: an editor -->")],
      ["a CDATA section", async () => svg("<style><![CDATA[rect{fill:red}]]></style>")],
      ["a processing instruction after the declaration", async () => svg('<?xml-stylesheet href="#s"?>')],
      ["a non-UTF-8 declared encoding (UTF-7)", async () => Buffer.from('<?xml version="1.0" encoding="UTF-7"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
      ["UTF-16 bytes", async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image/></svg>', "utf16le")],
      ["an XML entity declaration", async () => Buffer.from('<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg">&e;</svg>')],
      ["a non-fragment url()", async () => svg('<rect fill="url(other.svg#g)"/>')],
      ["character references spelling data: and base64 in a <use>", async () =>
        svg('<use href="&#x64;ata:image/svg+xml;&#x62;ase64,PHN2Zy8+#a"/>')],
      ["a character reference spelling a url() target", async () => svg('<rect fill="url(&#x6f;ther.svg#g)"/>')],
      ["an SVG over the SVG size cap", async () => svg(`<desc>${"x".repeat(SVG_MAX_UPLOAD_BYTES)}</desc>`)],
    ])("refuses an SVG with %s with 400", async (_label, build) => {
      const filesBefore = await logoDirListing();
      const res = await logoPost(merchantA).attach("logo", await build(), { filename: "logo.svg", contentType: "image/svg+xml" });

      expect(res.status).toBe(400);
      expect(await logoDirListing()).toEqual(filesBefore);
    });

    it("refuses a file over the size cap with 413", async () => {
      const oversized = Buffer.concat([await pngBytes(), Buffer.alloc(LOGO_MAX_UPLOAD_BYTES)]);
      const res = await logoPost(merchantA).attach("logo", oversized, { filename: "big.png", contentType: "image/png" });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("answers 400 for a missing file, an extra text field, or a malformed merchant id", async () => {
      expect((await logoPost(merchantA)).status).toBe(400);
      expect((await logoPost(merchantA).field("note", "no file")).status).toBe(400);
      const badId = await logoPost("not-a-uuid").attach("logo", await pngBytes(), { filename: "logo.png", contentType: "image/png" });
      expect(badId.status).toBe(400);
    });

    it("answers 404 for another household's merchant and leaves it untouched", async () => {
      const res = await logoPost(merchantB).attach("logo", await pngBytes(), { filename: "logo.png", contentType: "image/png" });

      expect(res.status).toBe(404);
      expect(await logoRows(merchantB)).toHaveLength(0);
      const [row] = await db.select().from(merchants).where(eq(merchants.id, merchantB));
      expect(row.logoUrl).toBeNull();
    });

    it("refuses view_only with 403 before reading the upload", async () => {
      const res = await logoPost(merchantA, "viewOnly").attach("logo", await pngBytes(), { filename: "logo.png", contentType: "image/png" });
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/merchants/:id keeps an uploaded logo path", () => {
    it("accepts the stored logo path the edit form sends back", async () => {
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantA));
      const res = await withCookie(request(app).put(`/api/merchants/${merchantA}`)).send({ name: merchant.name, logoUrl: merchant.logoUrl });
      expect(res.status).toBe(200);
      expect(res.body.data.merchant.logoUrl).toBe(merchant.logoUrl);
    });
  });

  describe("a logo another merchant still shows (merge or edit copied its URL)", () => {
    it("keeps the file when the original replaces or removes its logo", async () => {
      const [original] = await db.select().from(merchants).where(eq(merchants.id, merchantA));
      const sharedUrl = original.logoUrl!;
      const copy = await withCookie(request(app).put(`/api/merchants/${otherMerchantA}`)).send({ logoUrl: sharedUrl });
      expect(copy.status).toBe(200);

      const replaced = await logoPost(merchantA).attach("logo", await pngBytes(), { filename: "new.png", contentType: "image/png" });
      expect(replaced.status).toBe(200);
      expect((await withCookie(request(app).get(sharedUrl))).status).toBe(200);

      const removed = await withCookie(request(app).delete(`/api/merchants/${otherMerchantA}/logo`));
      expect(removed.status).toBe(200);
      expect(removed.body.data.merchant.logoUrl).toBeNull();
      expect((await withCookie(request(app).get(sharedUrl))).status).toBe(200);
    });
  });

  describe("DELETE /api/merchants/:id/logo", () => {
    it("refuses view_only and another household's merchant", async () => {
      const [before] = await db.select().from(merchants).where(eq(merchants.id, merchantA));
      expect((await withCookie(request(app).delete(`/api/merchants/${merchantA}/logo`), "viewOnly")).status).toBe(403);
      expect((await withCookie(request(app).delete(`/api/merchants/${merchantB}/logo`))).status).toBe(404);
      expect((await withCookie(request(app).delete("/api/merchants/not-a-uuid/logo"))).status).toBe(400);
      const [after] = await db.select().from(merchants).where(eq(merchants.id, merchantA));
      expect(after.logoUrl).toBe(before.logoUrl);
      expect(after.logoUrl).not.toBeNull();
    });

    it("clears the logo, keeps the file and its upload record for erasure, and audits the removal", async () => {
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantA));
      const stored = await rowForUrl(merchant.logoUrl!);
      const rowsBefore = await logoRows(merchantA);
      const res = await withCookie(request(app).delete(`/api/merchants/${merchantA}/logo`));

      expect(res.status).toBe(200);
      expect(res.body.data.merchant).toMatchObject({ id: merchantA, logoUrl: null });
      expect(await logoRows(merchantA)).toEqual(rowsBefore);
      expect(await storedBytes(stored.filePath)).not.toBeNull();
      const audits = (await auditRows(merchantA)).filter((row) => row.action === "UPDATE");
      expect(audits.at(-1)!.details).toMatchObject({ operation: "logo_remove", newValue: { logoUrl: null } });
    });
  });

  describe("aliases", () => {
    let aliasId: string;

    it("adds a trimmed alias to the household's merchant and audits it", async () => {
      const res = await withCookie(request(app).post(`/api/merchants/${merchantA}/aliases`)).send({ aliasName: "  SHOPRITE LSK  " });

      expect(res.status).toBe(201);
      expect(res.body.data.alias).toMatchObject({ merchantId: merchantA, aliasName: "SHOPRITE LSK" });
      aliasId = res.body.data.alias.id;
      const audits = await auditRows(aliasId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "CREATE", entityType: "merchant_alias", householdId: householdA, userId: userIds.get("owner") });
    });

    it.each([
      ["the same alias in another case", "shoprite lsk"],
      ["another merchant's name", "synthetic shoprite"],
    ])("refuses %s with 409", async (_label, aliasName) => {
      const res = await withCookie(request(app).post(`/api/merchants/${otherMerchantA}/aliases`)).send({ aliasName });
      expect(res.status).toBe(409);
      const rows = await db.select().from(merchantAliases).where(eq(merchantAliases.merchantId, otherMerchantA));
      expect(rows).toHaveLength(0);
    });

    it("refuses a merchant create or rename that takes an existing alias", async () => {
      const create = await withCookie(request(app).post("/api/merchants")).send({ name: "shoprite lsk" });
      expect(create.status).toBe(409);
      const rename = await withCookie(request(app).put(`/api/merchants/${otherMerchantA}`)).send({ name: "Shoprite LSK" });
      expect(rename.status).toBe(409);
      const [unchanged] = await db.select().from(merchants).where(eq(merchants.id, otherMerchantA));
      expect(unchanged.name).toBe("Synthetic Pick n Pay");
      const created = await db.select().from(merchants).where(eq(merchants.householdId, householdA));
      expect(created.map((row) => row.name.toLowerCase())).not.toContain("shoprite lsk");
    });

    it("lets only one of two concurrent identical aliases through", async () => {
      const [first, second] = await Promise.all([
        withCookie(request(app).post(`/api/merchants/${merchantA}/aliases`)).send({ aliasName: "RACE ALIAS" }),
        withCookie(request(app).post(`/api/merchants/${otherMerchantA}/aliases`)).send({ aliasName: "race alias" }),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const { rows } = await pool.query(
        "select a.id from merchant_aliases a join merchants m on m.id = a.merchant_id where m.household_id = $1 and lower(a.alias_name) = 'race alias'",
        [householdA],
      );
      expect(rows).toHaveLength(1);
    });

    it("answers 400 for an empty, missing or over-long alias", async () => {
      for (const body of [{ aliasName: "   " }, {}, { aliasName: "x".repeat(256) }]) {
        const res = await withCookie(request(app).post(`/api/merchants/${merchantA}/aliases`)).send(body);
        expect(res.status).toBe(400);
      }
    });

    it("answers 404 for another household's merchant and alias", async () => {
      const add = await withCookie(request(app).post(`/api/merchants/${merchantB}/aliases`)).send({ aliasName: "LEAK" });
      expect(add.status).toBe(404);
      const remove = await withCookie(request(app).delete(`/api/merchants/${merchantB}/aliases/${foreignAliasId}`));
      expect(remove.status).toBe(404);
      const crossed = await withCookie(request(app).delete(`/api/merchants/${merchantA}/aliases/${foreignAliasId}`));
      expect(crossed.status).toBe(404);
      const rows = await db.select().from(merchantAliases).where(eq(merchantAliases.id, foreignAliasId));
      expect(rows).toHaveLength(1);
    });

    it("refuses view_only with 403 on add and delete", async () => {
      const add = await withCookie(request(app).post(`/api/merchants/${merchantA}/aliases`), "viewOnly").send({ aliasName: "VIEWER" });
      expect(add.status).toBe(403);
      const remove = await withCookie(request(app).delete(`/api/merchants/${merchantA}/aliases/${aliasId}`), "viewOnly");
      expect(remove.status).toBe(403);
    });

    it("deletes the alias, audits it, and 404s a second delete", async () => {
      const res = await withCookie(request(app).delete(`/api/merchants/${merchantA}/aliases/${aliasId}`));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { deleted: true } });
      const rows = await db.select().from(merchantAliases).where(eq(merchantAliases.id, aliasId));
      expect(rows).toHaveLength(0);
      const audits = await auditRows(aliasId);
      expect(audits.map((row) => row.action)).toEqual(["CREATE", "DELETE"]);
      expect(audits[1].details).toMatchObject({ oldValue: { merchantId: merchantA, aliasName: "SHOPRITE LSK" } });
      const again = await withCookie(request(app).delete(`/api/merchants/${merchantA}/aliases/${aliasId}`));
      expect(again.status).toBe(404);
      const badId = await withCookie(request(app).delete(`/api/merchants/${merchantA}/aliases/not-a-uuid`));
      expect(badId.status).toBe(400);
    });
  });
});
