import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const installed = Symbol.for('pfa.test.network.guard');
const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Allow only the verified fixture DB and HTTP servers created by this process. */
export function installNetworkGuard({ target, browserOrigin } = {}) {
  if (globalThis[installed]) return;
  let browserEndpoint;
  if (browserOrigin) {
    if (browserOrigin !== target?.server?.origin) throw new Error('TEST NETWORK DENIED: browser origin must match the manifest');
    const origin = new URL(browserOrigin);
    const host = origin.hostname.replace(/^\[|\]$/g, '');
    if (origin.protocol !== 'http:' || !loopback.has(host) || !origin.port) throw new Error('TEST NETWORK DENIED: invalid browser origin');
    browserEndpoint = { host: host === 'localhost' ? '127.0.0.1' : host, port: +origin.port };
  }
  const ownedEndpoints = new Map();
  const automaticIPv6Ports = new Map();
  const automaticListeners = new WeakSet();
  const tracked = new WeakSet();
  const endpoint = (host, port) => `${host}:${port}`;
  const track = (server) => {
    const address = server.address();
    if (address && typeof address === 'object' && !tracked.has(server)) {
      // IPv6 wildcard coverage depends on OS/ipv6Only. Authorize only its
      // numeric IPv6 loopback; IPv4 wildcard necessarily covers IPv4 loopback.
      const host = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '::1' : address.address;
      if (!loopback.has(host)) return;
      const key = endpoint(host, address.port);
      const automaticIPv6 = address.address === '::' && automaticListeners.has(server);
      tracked.add(server);
      ownedEndpoints.set(key, (ownedEndpoints.get(key) ?? 0) + 1);
      if (automaticIPv6) automaticIPv6Ports.set(address.port, (automaticIPv6Ports.get(address.port) ?? 0) + 1);
      server.once('close', () => {
        const remaining = ownedEndpoints.get(key) - 1;
        if (remaining) ownedEndpoints.set(key, remaining); else ownedEndpoints.delete(key);
        if (automaticIPv6) {
          const count = automaticIPv6Ports.get(address.port) - 1;
          if (count) automaticIPv6Ports.set(address.port, count); else automaticIPv6Ports.delete(address.port);
        }
        tracked.delete(server);
        automaticListeners.delete(server);
      });
    }
  };
  // An unspecified-host listen(0) can expose address() synchronously, and
  // Supertest connects before the deferred 'listening' event is emitted.
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    // Node's unspecified-host path exposes address() synchronously; adding an
    // explicit host defers the bind and breaks Supertest's immediate read.
    const first = args[0];
    if (first && typeof first === 'object') {
      if ('port' in first && !first.host && !first.path && !('fd' in first)) {
        automaticListeners.add(this);
      }
    } else if ((typeof first === 'number' || /^\d+$/.test(first)) && typeof args[1] !== 'string') {
      automaticListeners.add(this);
    }
    const server = listen.apply(this, args);
    track(this);
    return server;
  };
  const emit = net.Server.prototype.emit;
  net.Server.prototype.emit = function (event, ...args) {
    if (event === 'listening') track(this);
    return emit.call(this, event, ...args);
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let first = args[0];
    if (Array.isArray(first)) first = first[0];
    const options = first && typeof first === 'object' ? first : {
      port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost',
    };
    let host = (options.host ?? 'localhost').replace(/^\[|\]$/g, '');
    const port = +options.port;
    const targetHost = target?.host.replace(/^\[|\]$/g, '');
    const databaseHost = targetHost === 'localhost' ? '127.0.0.1' : targetHost;
    if (host === 'localhost') {
      host = targetHost === 'localhost' && port === target.port ? databaseHost :
        browserEndpoint?.port === port ? browserEndpoint.host :
        ['127.0.0.1', '::1'].find((candidate) => ownedEndpoints.has(endpoint(candidate, port)));
    }
    // Supertest requests IPv4 after an automatic IPv6 wildcard bind. Pin that
    // request to the actually owned ::1 endpoint, never an unrelated IPv4 port.
    if (!(target && host === databaseHost && port === target.port) && host === '127.0.0.1' &&
        !ownedEndpoints.has(endpoint(host, port)) && automaticIPv6Ports.has(port)) host = '::1';
    const database = target && host === databaseHost && port === target.port;
    const browser = browserEndpoint && host === browserEndpoint.host && port === browserEndpoint.port;
    if (options.path || options.lookup || !loopback.has(host) || (!database && !browser && !ownedEndpoints.has(endpoint(host, port)))) {
      throw new Error('TEST NETWORK DENIED: only the manifest database and process-owned loopback servers are allowed');
    }
    // Dispatch numeric destinations only. No DNS or caller-supplied lookup can
    // redirect an allowed localhost string to an unrelated listener.
    const pinned = { ...options, host };
    const callback = Array.isArray(args[0]) ? args[0][1] : args.find((value) => typeof value === 'function');
    return connect.call(this, pinned, callback);
  };
  tls.connect = () => { throw new Error('TEST NETWORK DENIED: TLS/provider/mail/push dispatch is disabled'); };
  syncBuiltinESMExports();
  globalThis[installed] = true;
}
