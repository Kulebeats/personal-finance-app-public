// Dependency compatibility only: no application bootstrap, dotenv, DB or providers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import express from "express";
import multer from "multer";
import request from "supertest";
import nodemailer from "nodemailer";
import { parse } from "csv-parse/sync";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

test("CSV keeps quoted commas/newlines, BOM, CRLF and duplicate purchases", () => {
  const rows = parse('\uFEFFdate,description,amount\r\n2026-10-15,"Market, Lusaka",12.34\r\n2026-10-15,"Market, Lusaka",12.34\r\n2026-10-15,"two\nlines",-1.20\r\n', {
    bom: true, columns: true, skip_empty_lines: true,
  });
  assert.deepEqual(rows, [
    { date: "2026-10-15", description: "Market, Lusaka", amount: "12.34" },
    { date: "2026-10-15", description: "Market, Lusaka", amount: "12.34" },
    { date: "2026-10-15", description: "two\nlines", amount: "-1.20" },
  ]);
  assert.throws(() => parse('date,amount\n"unfinished,12.34', { columns: true }), /Quote Not Closed/);
});

test("duplicated __proto__ CSV columns cannot replace a record prototype", () => {
  const [row] = parse("__proto__,__proto__,name\na,b,fixture\n", {
    columns: true, group_columns_by_name: true,
  });
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(Object.hasOwn(row, "__proto__"), true);
  assert.deepEqual(row.__proto__, ["a", "b"]);
});

test("multipart upload accepts bytes and rejects an oversized file", async () => {
  const app = express();
  app.post("/upload", multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 } }).single("file"), (req, res) => {
    res.json({ name: req.file.originalname, bytes: req.file.buffer.toString("utf8") });
  });
  app.use((error, _req, res, _next) => res.status(400).json({ code: error.code }));
  await request(app).post("/upload").attach("file", Buffer.from("synthetic"), "fixture.csv")
    .expect(200, { name: "fixture.csv", bytes: "synthetic" });
  await request(app).post("/upload").attach("file", Buffer.alloc(33), "large.csv")
    .expect(400, { code: "LIMIT_FILE_SIZE" });
});

test("proxy trust preserves an untrusted hop and rejects mapped-subnet spoofing", async () => {
  const app = express();
  app.set("trust proxy", ["loopback", "::ffff:192.0.2.0/120"]);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.7, 198.51.100.8")
    .expect(200, { ip: "198.51.100.8" });
  app.set("trust proxy", "::ffff:10.0.0.0/8");
  const response = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.7").expect(200);
  assert.notEqual(response.body.ip, "203.0.113.7");
});

test("SMTP transport sends only to an owned loopback sink", { timeout: 10000 }, async () => {
  const received = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = "";
    let data = false;
    socket.write("220 localhost synthetic SMTP\r\n");
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf("\r\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data && line !== ".") received.push(line);
        else if (data) { data = false; socket.write("250 accepted\r\n"); }
        else if (line.startsWith("EHLO")) socket.write("250 localhost\r\n");
        else if (line === "DATA") { data = true; socket.write("354 send message\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const transport = nodemailer.createTransport({ host: "127.0.0.1", port: server.address().port, secure: false, ignoreTLS: true });
  try {
    const info = await transport.sendMail({ from: "sender@example.invalid", to: "recipient@example.invalid", subject: "Local SMTP fixture", text: "Synthetic loopback delivery" });
    assert.deepEqual(info.accepted, ["recipient@example.invalid"]);
    assert.match(received.join("\n"), /Synthetic loopback delivery/);
  } finally {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("mail MIME/envelope composition stays local and preserves content", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  try {
    const info = await transport.sendMail({
      from: "sender@example.invalid", to: "recipient@example.invalid",
      subject: "Synthetic runtime fixture", text: "Local compatibility test",
    });
    assert.deepEqual(info.envelope, { from: "sender@example.invalid", to: ["recipient@example.invalid"] });
    assert.match(info.message.toString(), /Subject: Synthetic runtime fixture/);
    assert.match(info.message.toString(), /Local compatibility test/);
  } finally {
    transport.close();
  }
});

test("native image codecs resize, thumbnail and preprocess receipt bytes", async () => {
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "white" } }).png().toBuffer();
  const jpeg = await sharp(input).resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [2000, 1000, "jpeg"]);
  assert.equal((await fileTypeFromBuffer(jpeg)).mime, "image/jpeg");
  const thumbnail = await sharp(input).resize(200, 200, { fit: "cover", position: "top" }).jpeg({ quality: 80 }).toBuffer();
  assert.equal((await sharp(thumbnail).metadata()).height, 200);
  const ocr = await sharp(input).greyscale().normalize().sharpen().modulate({ brightness: 1.1 }).toBuffer();
  assert.equal((await sharp(ocr).metadata()).width, 2400);
});
