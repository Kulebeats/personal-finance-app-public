import { assertDatabaseIdentity } from './test-target.mjs';
import pg from 'pg';

const installed = Symbol.for('pfa.test.postgres.guard');

/** Protect every worker's pools and direct clients, including changed env URLs. */
export async function installPostgresGuard({ mode, target }) {
  if (globalThis[installed]) return;
  const connect = pg.Client.prototype.connect;
  const query = pg.Client.prototype.query;
  const verified = new WeakSet();
  pg.Client.prototype.query = function (...args) {
    if (!verified.has(this)) throw new Error('TEST DATABASE DENIED: client has not passed the persisted run-marker check');
    return query.apply(this, args);
  };
  pg.Client.prototype.connect = function (callback) {
    const parameters = this.connectionParameters;
    const matches = mode === 'database' && target &&
      parameters.host === target.host.replace(/^\[|\]$/g, '') &&
      +parameters.port === target.port && parameters.database === target.database && !parameters.ssl;
    const promise = new Promise((resolve, reject) => {
      if (!matches) return reject(new Error('TEST DATABASE DENIED: connection host/port/database must match the immutable disposable manifest'));
      let finished = false;
      const fail = (failure) => {
        if (finished) return;
        finished = true;
        // pg can emit error as well as reject the marker query before Pool has
        // installed its idle listener. Keep this listener through cleanup.
        const cleanup = this.end();
        Promise.resolve(cleanup).catch(() => {}).finally(() => this.removeListener('error', fail));
        reject(failure);
      };
      this.on('error', fail);
      connect.call(this, async (error) => {
        if (error) return fail(error);
        try {
          const { rows } = await query.call(this, `SELECT current_database() AS database,
            host(inet_server_addr()) AS host, inet_server_port() AS port,
            shobj_description(oid, 'pg_database') AS marker
            FROM pg_database WHERE datname = current_database()`);
          assertDatabaseIdentity(rows, target);
          if (finished) return;
          verified.add(this);
          finished = true;
          this.removeListener('error', fail);
          resolve();
        } catch (failure) { fail(failure); }
      });
    });
    if (typeof callback === 'function') {
      promise.then(() => callback(null), callback);
      return;
    }
    return promise;
  };
  globalThis[installed] = true;
}
