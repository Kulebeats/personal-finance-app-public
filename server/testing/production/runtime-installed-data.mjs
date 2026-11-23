import path from 'node:path';

const prefix = 'node_modules/fast-geoip/data/';
/** Exact callback surface consumed by installed fast-geoip 1.1.88. Never exposes a real fd. */
export function createInstalledDataAccess(stageRoot, relativeNames, readPinned, onViolation = () => {}) {
  const names = new Map(relativeNames.filter(name => name.startsWith(prefix)).map(name => [path.win32.join(stageRoot, ...name.split('/')), name]));
  const handles = new Map(); let serial = 0x40000000; let closed = false; let tainted = false; let firstViolation;
  const events = { wholeReads: 0, rangeReads: 0, opened: 0, closed: 0 };
  const mark = phase => { tainted = true; firstViolation ??= phase; onViolation(firstViolation); };
  const refuse = phase => { mark(phase); throw new Error(`INSTALLED_LOADING_REFUSED:${phase}`); };
  const check = (value, phase) => { if (!value) refuse(phase); };
  const alive = () => check(!closed, 'CLOSED');
  const member = name => {
    alive(); check(typeof name === 'string' && path.win32.normalize(name) === name && names.has(name), 'DATA_PATH'); return names.get(name);
  };
  const callback = (cb, operation) => {
    check(typeof cb === 'function', 'DATA_CALLBACK');
    queueMicrotask(() => {
      let args; try { alive(); args = operation(); } catch (error) { mark(/^INSTALLED_LOADING_REFUSED:([A-Z_]+)$/.exec(error.message ?? '')?.[1] ?? 'DATA_IO'); cb(error); return; }
      cb(null, ...args);
    });
  };
  const unsupported = () => refuse('DATA_API');
  const facade = {
    readFile(name, cb) { callback(cb, () => { const value = Buffer.from(readPinned(member(name))); events.wholeReads++; return [value]; }); },
    open(name, flags, cb) {
      callback(cb, () => {
        check(flags === 'r' && handles.size < 64, 'DATA_OPEN'); const relative = member(name);
        check(relative === `${prefix}locations.json`, 'DATA_OPEN');
        const handle = serial++; handles.set(handle, relative); events.opened++; return [handle];
      });
    },
    read(handle, buffer, offset, length, position, cb) {
      callback(cb, () => {
        check(handles.has(handle) && Buffer.isBuffer(buffer) && offset === 0 && length === 111 && buffer.length === 111 &&
          Number.isSafeInteger(position) && position >= 1 && position % 112 === 1, 'DATA_RANGE');
        const bytes = readPinned(handles.get(handle)); check(position + length <= bytes.length, 'DATA_RANGE');
        bytes.copy(buffer, 0, position, position + length); events.rangeReads++; return [length, buffer];
      });
    },
    close(handle, cb) { callback(cb, () => { check(handles.delete(handle), 'DATA_HANDLE'); events.closed++; return []; }); },
    readFileSync: unsupported, openSync: unsupported, readSync: unsupported, closeSync: unsupported,
  };
  return Object.freeze({ fs: Object.freeze(facade),
    events: () => Object.freeze({ ...events, active: handles.size }),
    violation: () => firstViolation,
    assertHealthy() { alive(); check(!tainted && handles.size === 0, 'TAINTED'); },
    close() { closed = true; handles.clear(); },
  });
}
