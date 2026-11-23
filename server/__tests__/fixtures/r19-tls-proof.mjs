// Explicitly authorized TLS-only fixture child. No application/DB/providers.
// Ordinary unit workers retain their blanket TLS denial.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import net from "node:net";
import dns from "node:dns";
import { execFileSync } from "node:child_process";
import { resolveDatabaseConnection, resolveDatabaseSsl } from "../../dbSsl.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pfa-r19-tls-"));
const openssl = process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : "openssl";
const run = (...args) => execFileSync(openssl, args, { cwd: directory, stdio: "ignore", timeout: 10000 });
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");
const sockets = new Set();
let server;
const originalConnect = net.Socket.prototype.connect;
const originalLookup = dns.lookup;
let externalConnectionAttempts = 0;
let allowedConnections = 0;
let dnsLookups = 0;

try {
  run("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
    "-days", "2", "-subj", "/CN=Capital-Synthetic-Test-CA", "-addext", "basicConstraints=critical,CA:TRUE");
  run("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=tls-fixture.invalid");
  fs.writeFileSync(path.join(directory, "leaf.ext"), "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:tls-fixture.invalid,IP:127.0.0.1\n");
  run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "2", "-extfile", "leaf.ext");
  fs.writeFileSync(path.join(directory, "localhost.ext"), "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n");
  run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "localhost.pem", "-days", "2", "-extfile", "localhost.ext");

  server = tls.createServer({ key: read("leaf.key"), cert: read("leaf.pem") });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("tlsClientError", () => {}); // Expected trust/hostname negatives.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  dns.lookup = () => { dnsLookups++; throw new Error("TLS fixture DNS is forbidden"); };
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (!first || first.host !== "127.0.0.1" || +first.port !== port || first.path || first.lookup) {
      externalConnectionAttempts++;
      throw new Error("TLS fixture permits only its own numeric loopback endpoint");
    }
    allowedConnections++;
    return originalConnect.apply(this, args);
  };
  const connect = (ssl, servername = "tls-fixture.invalid") => new Promise((resolve) => {
    const socket = tls.connect({ host: "127.0.0.1", port, servername, ...ssl });
    socket.setTimeout(1000, () => socket.destroy(new Error("TLS fixture timeout")));
    socket.once("secureConnect", () => { resolve({ authorized: socket.authorized }); socket.destroy(); });
    socket.once("error", (error) => { resolve({ authorized: false, code: error.code }); socket.destroy(); });
  });
  const correct = resolveDatabaseSsl({ NODE_ENV: "production", DATABASE_SSL_CA_CERT: read("ca.pem") });
  const positive = await connect(correct);
  const noConfiguredCA = await connect(resolveDatabaseSsl({ NODE_ENV: "production" }));
  const wrongCA = await connect(resolveDatabaseSsl({ NODE_ENV: "production", DATABASE_SSL_CA_CERT: tls.rootCertificates[0] }));
  const wrongHostname = await connect(correct, "wrong-fixture.invalid");
  // pg upgrades an already connected socket and omits servername for numeric
  // hosts. Do not provide tls.connect's host shortcut: it masks that boundary.
  const numericConfig = resolveDatabaseConnection({ NODE_ENV: "production",
    DATABASE_URL: `postgresql://synthetic@127.0.0.1:${port}/synthetic`, DATABASE_SSL_CA_CERT: read("ca.pem") });
  const pgConnect = () => new Promise((resolve) => {
    const plain = net.connect({ host: numericConfig.host, port: numericConfig.port });
    plain.once("connect", () => {
      const socket = tls.connect({ socket: plain, ...numericConfig.ssl });
      socket.setTimeout(1000, () => socket.destroy(new Error("TLS fixture timeout")));
      socket.once("secureConnect", () => { resolve({ authorized: socket.authorized }); socket.destroy(); });
      socket.once("error", (error) => { resolve({ authorized: false, code: error.code }); socket.destroy(); });
    });
    plain.once("error", (error) => { resolve({ authorized: false, code: error.code }); plain.destroy(); });
  });
  const pgNumericPositive = await pgConnect();
  server.setSecureContext({ key: read("leaf.key"), cert: read("localhost.pem") });
  const pgWrongIdentity = await pgConnect();
  assert.deepEqual({ configuredIP: pgNumericPositive.authorized, wrongLocalhost: pgWrongIdentity.authorized },
    { configuredIP: true, wrongLocalhost: false }, "pg-shaped socket must check the configured IP identity");
  assert.equal(pgWrongIdentity.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(positive.authorized, true);
  for (const negative of [noConfiguredCA, wrongCA, wrongHostname]) assert.equal(negative.authorized, false);
  assert.equal(wrongHostname.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(externalConnectionAttempts, 0);
  assert.equal(dnsLookups, 0);
  console.log(JSON.stringify({ node: process.version, arch: process.arch, openssl: process.versions.openssl,
    host: "127.0.0.1", port, positiveVerified: true, unknownCARejected: true, wrongCARejected: true,
    wrongHostnameRejected: true, negativeCodes: [noConfiguredCA.code, wrongCA.code, wrongHostname.code],
    pgNumericVerified: true, pgWrongIdentityRejected: true,
    allowedConnections, externalConnectionAttempts, dnsLookups }));
} finally {
  net.Socket.prototype.connect = originalConnect;
  dns.lookup = originalLookup;
  for (const socket of sockets) socket.destroy();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  const resolved = fs.realpathSync(directory);
  const temporaryRoot = fs.realpathSync(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith("pfa-r19-tls-"));
  fs.rmSync(resolved, { recursive: true, force: true });
}
