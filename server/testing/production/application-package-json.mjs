/** Preserve package condition order while rejecting duplicate keys and excessive depth. */
export function parseApplicationPackageJson(text) {
  const refuse = () => { throw new Error('APPLICATION_PACKAGE_JSON_REFUSED'); };
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) refuse();
  const stack = []; let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i; let escaped = false, closed = false;
      while (++i < text.length) {
        if (escaped) escaped = false;
        else if (text[i] === '\\') escaped = true;
        else if (text[i] === '"') { closed = true; break; }
      }
      if (!closed || ++tokens > 100000) refuse();
      const value = JSON.parse(text.slice(start, i+1));
      const frame = stack.at(-1);
      if (frame?.keys && frame.expectsKey) {
        if (frame.keys.has(value)) refuse();
        frame.keys.add(value); frame.expectsKey = false;
      }
    } else if (char === '{' || char === '[') {
      if (stack.length >= 32 || ++tokens > 100000) refuse();
      stack.push(char === '{' ? { keys: new Set(), expectsKey: true } : {});
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.keys) stack.at(-1).expectsKey = true;
  }
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) refuse();
  return result;
}
