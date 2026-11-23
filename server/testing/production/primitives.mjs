import { createHash } from 'node:crypto';
import path from 'node:path';
import { types } from 'node:util';

export const refuse = () => { throw new Error('PRODUCTION_MANIFEST_REFUSED: invalid, unpinned or unsupported contract'); };
export const check = (value) => { if (!value) refuse(); };
export const matches = (value, regex) => check(typeof value === 'string' && regex.test(value));
export const integer = (value, max) => check(Number.isSafeInteger(value) && value > 0 && value <= max);
export function hash(value, length = 64) { matches(value, new RegExp(`^[a-f0-9]{${length}}$`)); check(!/^0+$/.test(value)); }
export const uuid = (value) => matches(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export function shape(value, keys) { check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))); }
export function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function canonicalJson(value) {
  let nodes = 0; const seen = new Set();
  const visit = (item, depth = 0) => {
    check(++nodes <= 12000 && depth <= 10);
    if (typeof item === 'boolean') return item;
    if (typeof item === 'string') { check(item.length <= 2048); return item; }
    if (typeof item === 'number') { check(Number.isSafeInteger(item)); return item; }
    check(item && typeof item === 'object' && !types.isProxy(item) && !seen.has(item)); seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors); let result;
    if (Array.isArray(item)) {
      check(item.length <= 512 && keys.length === item.length + 1);
      result = Array.from({ length: item.length }, (_, index) => { check(descriptors[index] && 'value' in descriptors[index]); return visit(descriptors[index].value, depth + 1); });
    } else {
      check(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
      check(keys.length <= 32 && keys.every((key) => typeof key === 'string' && key.length <= 128)); keys.sort(); result = Object.create(null);
      for (const key of keys) { check('value' in descriptors[key]); result[key] = visit(descriptors[key].value, depth + 1); }
    }
    seen.delete(item); return result;
  };
  const text = JSON.stringify(visit(value)); check(Buffer.byteLength(text) <= 256 * 1024); return text;
}
export function parse(text) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= 256 * 1024);
  let value; try { value = JSON.parse(text); } catch { refuse(); }
  check(canonicalJson(value) === text); return value;
}
export function digest(text) { check(typeof text === 'string' && Buffer.byteLength(text) <= 256 * 1024); return createHash('sha256').update(text).digest('hex'); }
export function absolute(value) {
  matches(value, /^[A-Z]:\\/); check(value.length <= 1024 && !/[\x00-\x1f\x7f%?#/]/.test(value) && path.win32.normalize(value) === value);
  for (const segment of value.slice(3).split('\\')) {
    check(segment && !/[ .]$/.test(segment) && !/[<>:"|*?]/.test(segment) && !/~\d/.test(segment));
    check(!/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(segment));
  }
  return value;
}
export function within(root, file) { absolute(root); absolute(file); return file.toLowerCase().startsWith(`${root.toLowerCase()}\\`); }
export function disjoint(a, b) { check(a.toLowerCase() !== b.toLowerCase() && !within(a, b) && !within(b, a)); }
export function relative(root, value) {
  matches(value, /^[A-Za-z0-9._/-]{1,256}$/); check(!value.split('/').some((part) => !part || part === '.' || part === '..'));
  const file = path.win32.join(root, ...value.split('/')); absolute(file); check(within(root, file)); return file;
}
