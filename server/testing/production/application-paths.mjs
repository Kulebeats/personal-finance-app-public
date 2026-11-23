import path from 'node:path';
import { absolute, check } from './primitives.mjs';

/** A physical directory entry, distinct from the stricter emitted graph paths. */
export function applicationEntryPath(directory, name) {
  absolute(directory);
  check(typeof name === 'string' && name.length > 0 && name.length <= 256 && name !== '.' && name !== '..' && !/[\\/]/.test(name));
  const file = path.win32.join(directory, name); absolute(file);
  check(path.win32.dirname(file) === directory && path.win32.basename(file) === name);
  return file;
}

export function applicationRelativeTarget(directory, value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 256);
  let current = directory;
  for (const segment of value.split('/')) current = applicationEntryPath(current, segment);
  return current;
}
