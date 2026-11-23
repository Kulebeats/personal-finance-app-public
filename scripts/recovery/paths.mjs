import path from 'node:path';
import { check } from './common.mjs';

/** Lexical only: never claims to detect a real filesystem junction/symlink. */
export function absolute(value) {
  check(typeof value === 'string' && value.length > 1 && value.length <= 1024 && !/[\x00-\x1f\x7f%?#]/.test(value));
  const windows = /^[A-Z]:\\/.test(value);
  check(windows || (value.startsWith('/') && !value.startsWith('//')));
  const api = windows ? path.win32 : path.posix;
  check(api.isAbsolute(value) && api.normalize(value) === value);
  const tail = windows ? value.slice(3) : value.slice(1);
  check(!tail.includes(':') && !(windows && tail.includes('/')));
  for (const segment of tail.split(windows ? '\\' : '/')) {
    check(segment && segment !== '.' && segment !== '..' && !/[ .]$/.test(segment) && !/[<>"|*?]/.test(segment) && !/~\d/.test(segment));
    check(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
  }
  return value;
}
export function apiFor(root) { absolute(root); return /^[A-Z]:\\/.test(root) ? path.win32 : path.posix; }
export function contained(root, file) {
  const api = apiFor(root); absolute(file);
  const normalize = (value) => api === path.win32 ? value.toLowerCase() : value;
  check(normalize(file).startsWith(normalize(root + api.sep)) && apiFor(file) === api);
  return file;
}
export function child(root, relative) {
  check(typeof relative === 'string' && /^[a-z0-9][a-z0-9./-]{0,159}$/.test(relative) && !relative.split('/').some((part) => !part || part === '.' || part === '..'));
  return contained(root, apiFor(root).join(root, ...relative.split('/')));
}
export function disjoint(left, right) {
  const api = apiFor(left); check(apiFor(right) === api);
  const lower = (value) => api === path.win32 ? value.toLowerCase() : value;
  const a = lower(left), b = lower(right); check(a !== b && !a.startsWith(b + api.sep) && !b.startsWith(a + api.sep));
}
