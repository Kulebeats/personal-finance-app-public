import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { PLAN, refuse } from './pg-tls-contract.mjs';

/** Component child only. Does not alter ordinary guards or attest native process egress. */
export function installBoundary(modules = { net, tls, dns, http, https, globals: globalThis, sync: syncBuiltinESMExports }) {
  const originals = [], owned = new WeakSet(); let connections = 0, tlsUpgrades = 0, denied = 0, dnsCalls = 0;
  const replace = (object, key, value) => { originals.push([object, key, object[key]]); object[key] = value; };
  const reject = () => { denied++; refuse(); };
  const connect = modules.net.Socket.prototype.connect;
  replace(modules.net.Socket.prototype, 'connect', function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = values[0] && typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
    if (options.host !== PLAN.target.host || ![PLAN.target.port, String(PLAN.target.port)].includes(options.port) ||
        options.path || options.lookup || options.fd !== undefined || owned.has(this)) reject();
    owned.add(this); connections++; return connect.apply(this, args);
  });
  const upgrade = modules.tls.connect;
  replace(modules.tls, 'connect', function (options, ...args) {
    if (!options?.socket || !owned.has(options.socket) || options.socket.remoteAddress !== PLAN.target.host ||
        options.socket.remotePort !== PLAN.target.port || options.host || options.port || options.path || options.lookup ||
        options.rejectUnauthorized !== true || typeof options.ca !== 'string' || typeof options.checkServerIdentity !== 'function') reject();
    tlsUpgrades++; return upgrade.call(this, options, ...args);
  });
  for (const object of [modules.dns, modules.dns.promises]) {
    for (const key of Object.keys(object)) if (typeof object[key] === 'function' && /^(?:lookup|resolve|reverse)/.test(key)) {
      replace(object, key, () => { dnsCalls++; reject(); });
    }
  }
  for (const object of [modules.http, modules.https]) for (const key of ['request', 'get']) replace(object, key, reject);
  replace(modules.globals, 'fetch', reject); replace(modules.net.Server.prototype, 'listen', reject);
  modules.sync();
  return { report: () => ({ connections, tlsUpgrades, denied, dns: dnsCalls }),
    restore() { for (const [object, key, value] of originals.reverse()) object[key] = value; modules.sync(); } };
}
