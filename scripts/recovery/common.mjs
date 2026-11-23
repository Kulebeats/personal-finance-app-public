import { createHash } from 'node:crypto';

export const refuse = () => { throw new Error('RECOVERY_REFUSED: invalid, unpinned or unsupported contract'); };
export const check = (condition) => { if (!condition) refuse(); };
export function shape(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}
export function hash(value, length = 64) { check(typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value) && !/^0+$/.test(value)); }
export function label(value) { check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)); }
export function instant(value) { check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value); return Date.parse(value); }
export function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function canonicalJson(value) {
  let nodes = 0; const seen = new Set();
  const visit = (item, depth = 0) => {
    check(++nodes <= 10000 && depth <= 8);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') { check(item.length <= 4096); return item; }
    if (typeof item === 'number') { check(Number.isSafeInteger(item)); return item; }
    check(item && typeof item === 'object' && !seen.has(item)); seen.add(item);
    let result;
    if (Array.isArray(item)) {
      check(item.length <= 1024 && Reflect.ownKeys(item).length === item.length + 1);
      const descriptors = Object.getOwnPropertyDescriptors(item);
      result = Array.from({ length: item.length }, (_, index) => { check(descriptors[index] && 'value' in descriptors[index]); return visit(descriptors[index].value, depth + 1); });
    } else {
      check(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
      const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors);
      check(keys.length <= 64 && keys.every((key) => typeof key === 'string')); keys.sort();
      result = Object.create(null);
      for (const key of keys) { check(key.length <= 128 && 'value' in descriptors[key]); result[key] = visit(descriptors[key].value, depth + 1); }
    }
    seen.delete(item); return result;
  };
  const text = JSON.stringify(visit(value)); check(Buffer.byteLength(text) <= 1024 * 1024); return text;
}
export function parse(text) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024);
  let value; try { value = JSON.parse(text); } catch { refuse(); }
  check(canonicalJson(value) === text); return value;
}
export function digest(text) { check(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024); return createHash('sha256').update(text).digest('hex'); }
