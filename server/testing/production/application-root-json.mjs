import { createHash } from 'node:crypto';

export const graphRefuse = () => { throw new Error('APPLICATION_GRAPH_REFUSED'); };
export const graphCheck = value => { if (!value) graphRefuse(); };
export const graphDigest = text => createHash('sha256').update(text, 'utf8').digest('hex');

// Only parsed JSON enters this serializer. No caller objects/accessors are visited.
export function graphStable(value) {
  if (Array.isArray(value)) return `[${value.map(graphStable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${graphStable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function parseCanonicalGraphJson(text, maximumBytes) {
  graphCheck(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= maximumBytes);
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') graphCheck(++depth <= 16);
    else if (char === '}' || char === ']') graphCheck(--depth >= 0);
  }
  graphCheck(!quoted && depth === 0);
  const value = JSON.parse(text);
  let nodes = 0;
  function validate(item) {
    graphCheck(++nodes <= 150000);
    if (typeof item === 'number') graphCheck(Number.isSafeInteger(item));
    else if (typeof item === 'string') graphCheck(item.length <= 1024 && !/[\uD800-\uDFFF]/u.test(item));
    else if (item && typeof item === 'object') {
      graphCheck(Object.keys(item).every(key => key.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(key)));
      Object.values(item).forEach(validate);
    }
  }
  validate(value);
  // Canonical re-encoding rejects duplicate keys, alternate encodings, whitespace,
  // BOMs and missing/extra newlines, including duplicate keys with equal values.
  graphCheck(graphStable(value) + '\n' === text);
  return value;
}
