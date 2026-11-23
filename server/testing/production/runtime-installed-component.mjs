import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import geoip from 'fast-geoip';

/** The only executable installed component: no application, DB, provider, listener or messages. */
export default async function runInstalledComponent(scenario) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if (scenario === 'unknown-module') { console.log('R20_INSTALLED_CONTROL:MODULE_PATH'); await import('./runtime-installed-data.mjs').catch(() => {}); }
  if (scenario === 'unknown-data') { console.log('R20_INSTALLED_CONTROL:DATA_PATH'); await new Promise(resolve => fs.readFile(path.join(root, 'node_modules/fast-geoip/data/not-indexed.json'), () => resolve())); }
  if (scenario === 'native-substitution') { console.log('R20_INSTALLED_CONTROL:NATIVE_PATH'); try { process.dlopen({}, path.join(root, 'node_modules/@img/sharp-win32-arm64/lib/other.node')); } catch {} }
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 128, b: 255 } } }).png().toBuffer();
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const output = await sharp(png).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, 1); assert.equal(output.info.height, 1); assert.equal(output.info.channels, 3);
  assert.deepEqual(Array.from(output.data), [0, 128, 255]);
  const location = await geoip.lookup('8.8.8.8');
  assert.ok(location); assert.equal(location.country, 'US');
  assert.deepEqual(location.range, [134742016, 134750208]);
  return Object.freeze({ sharp: 'buffer-png-resize', country: location.country });
}
