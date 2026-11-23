import { check, shape, hash, integer } from './primitives.mjs';
import { filePin } from './layout.mjs';

function certificate(value, root) { shape(value, ['file', 'derSha256']); filePin(value.file, root, 65536); hash(value.derSha256); }
export function validateTls(value, paths) {
  shape(value, ['https', 'postgres']);
  for (const role of Object.values(value)) {
    shape(role, ['identityHost', 'rejectUnauthorized', 'ca', 'leaf']); check(role.identityHost === '127.0.0.1' && role.rejectUnauthorized === true);
    certificate(role.ca, paths.publicTlsRoot); certificate(role.leaf, paths.publicTlsRoot);
    check(role.ca.derSha256 !== role.leaf.derSha256 && role.ca.file.path.toLowerCase() !== role.leaf.file.path.toLowerCase());
  }
}
export function validateChromium(value, paths, tls) {
  shape(value, ['engine', 'version', 'executable', 'trust', 'ignoreHTTPSErrors', 'proxyBypass', 'quic', 'launchPolicy']);
  check(value.engine === 'chromium' && value.version === '145.0.7632.6'); filePin(value.executable, paths.browserRuntimeRoot, 1024 ** 3);
  shape(value.trust, ['contract', 'relativeDatabasePath', 'databaseVersion', 'lastCompatibleVersion', 'caDerSha256', 'trustMetadataHex']);
  check(value.trust.contract === 'chromium145-servercertificate-v1' && value.trust.relativeDatabasePath === 'Default/ServerCertificate');
  check(value.trust.databaseVersion === 1 && value.trust.lastCompatibleVersion === 1 && value.trust.trustMetadataHex === '0a020803');
  hash(value.trust.caDerSha256); check(value.trust.caDerSha256 === tls.https.ca.derSha256);
  check(value.ignoreHTTPSErrors === false && value.proxyBypass === '<-loopback>' && value.quic === false && value.launchPolicy === 'pfa-chromium145-strict-v1');
}
export function validatePolicy(value, origin) {
  shape(value, ['nodeEnv', 'serverTimezone', 'actorTimezone', 'appOrigin', 'clientOrigin', 'forwarding', 'egress', 'providers', 'mail', 'push', 'workers']);
  check(value.nodeEnv === 'production' && value.serverTimezone === 'UTC' && value.actorTimezone === 'Africa/Lusaka');
  check(value.appOrigin === origin && value.clientOrigin === origin && value.forwarding === 'strip-and-set-single-hop-v1' && value.egress === 'exact-role-routing-v1');
  for (const key of ['providers', 'mail', 'push', 'workers']) check(value[key] === 'disabled');
}
export function validateTimeouts(value) {
  shape(value, ['connectMs', 'dependencyProbeMs', 'navigationMs', 'runMs']);
  for (const [key, max] of Object.entries({ connectMs: 5000, dependencyProbeMs: 2000, navigationMs: 30000, runMs: 3600000 })) integer(value[key], max);
  for (const key of ['connectMs', 'dependencyProbeMs', 'navigationMs']) check(value[key] <= value.runMs);
}
