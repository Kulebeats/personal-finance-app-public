import http from "node:http";
import type { Socket } from "node:net";
import { createHash } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStore } from "../../storage/s3";
import { createOwnedS3Objects } from "./owned-s3-objects";

export async function ownedS3() {
  const objects = createOwnedS3Objects();
  const sockets = new Set<Socket>();
  const state = { mode: "normal", requests: 0, signatures: 0, checkedWrites: 0, liveSockets: 0,
    lastGetVersionId: undefined as string | undefined };
  const server = http.createServer(async (req, res) => {
    state.requests++;
    const signed = /^AWS4-HMAC-SHA256 Credential=synthetic-access\//.test(req.headers.authorization ?? "");
    if (signed) state.signatures++;
    const error = (status: number, code: string) => { res.writeHead(status, { "content-type": "application/xml" }); res.end(`<Error><Code>${code}</Code></Error>`); };
    if (!signed) { error(403, "AccessDenied"); return; }
    if (req.headers["x-amz-acl"]) { error(403, "UnexpectedACL"); return; }
    if (state.mode === "forbidden") { error(403, "AccessDenied"); return; }
    if (state.mode === "unavailable") { error(503, "ServiceUnavailable"); return; }
    if (state.mode === "hang") return;
    const url = new URL(req.url!, "http://127.0.0.1");
    const key = url.pathname.replace(/^\/synthetic-bucket\/?/, "");
    if (req.method === "HEAD" && !key) { res.writeHead(200); res.end(); return; }
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (req.headers["x-amz-checksum-sha256"] !== Buffer.from(sha256, "hex").toString("base64") || req.headers["x-amz-meta-sha256"] !== sha256) { error(400, "BadDigest"); return; }
      if (objects.get(key) && req.headers["if-none-match"] === "*") { error(412, "PreconditionFailed"); return; }
      state.checkedWrites++;
      const object = objects.put(key, { bytes, mediaType: req.headers["content-type"]! });
      if (state.mode === "lost-write") return;
      res.writeHead(200, { etag: '"not-a-content-checksum"', "x-amz-version-id": object.versionId }); res.end(); return;
    }
    if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); res.end(); return; }
    const versionId = url.searchParams.get("versionId") ?? undefined;
    if (req.method === "GET") state.lastGetVersionId = versionId;
    const object = objects.get(key, versionId);
    if (!object) { error(404, versionId === undefined ? "NoSuchKey" : "NoSuchVersion"); return; }
    const sha256 = state.mode === "wrong-hash" ? "0".repeat(64) : object.sha256;
    res.writeHead(200, { "content-type": object.mediaType, "content-length": object.bytes.length,
      "x-amz-meta-sha256": sha256, "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
      "x-amz-version-id": object.versionId });
    if (req.method === "HEAD") { res.end(); return; }
    if (state.mode === "stream-hang") { res.write(object.bytes.subarray(0, 1)); return; }
    res.end(state.mode === "tampered" ? Buffer.alloc(object.bytes.length) : object.bytes);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Owned S3 fixture did not bind");
  const client = new S3Client({ endpoint: `http://127.0.0.1:${address.port}`, region: "synthetic-region", forcePathStyle: true,
    credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" }, maxAttempts: 1, followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 100, requestTimeout: 1000 } });
  const store = new S3ObjectStore("synthetic-bucket", client);
  return { state, store, objects, port: address.port,
    waitForRequest: () => new Promise<void>((resolve) => server.once("request", () => resolve())), async close() {
    client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    objects.retire();
    state.liveSockets = sockets.size;
  } };
}
