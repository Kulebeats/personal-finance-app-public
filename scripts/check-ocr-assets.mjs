#!/usr/bin/env node
// Post-build check (OPS-004): the production build serves the self-hosted
// tesseract.js runtime same-origin, as byte-for-byte copies of the
// lockfile-installed packages. Run after `npm run build` (CI: check:bundle).
// The expected list restates shared/ocrAssets.ts on purpose: this check must
// fail if that manifest or the Vite plugin drops a file.
import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist/public");
const expected = [
  ["ocr/worker.min.js", "tesseract.js/dist/worker.min.js"],
  ["ocr/core/tesseract-core-lstm.wasm.js", "tesseract.js-core/tesseract-core-lstm.wasm.js"],
  ["ocr/core/tesseract-core-simd-lstm.wasm.js", "tesseract.js-core/tesseract-core-simd-lstm.wasm.js"],
  ["ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["ocr/lang/eng.traineddata.gz", "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"],
];

if (!fs.existsSync(path.join(distRoot, "index.html"))) {
  console.error("dist/public/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}

const failures = [];
for (const [served, source] of expected) {
  const builtPath = path.join(distRoot, ...served.split("/"));
  const sourcePath = path.resolve("node_modules", ...source.split("/"));
  if (!fs.existsSync(builtPath)) {
    failures.push(`${served}: not in the build output`);
    continue;
  }
  const built = fs.readFileSync(builtPath);
  if (built.length === 0) {
    failures.push(`${served}: empty`);
    continue;
  }
  if (!built.equals(fs.readFileSync(sourcePath))) {
    failures.push(`${served}: differs from the installed ${source}`);
    continue;
  }
  console.log(`ok ${served} (${(built.length / 1e6).toFixed(2)} MB) = ${source}`);
}

if (failures.length > 0) {
  console.error(`OCR asset check failed:\n${failures.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`OCR asset check passed: ${expected.length} files served same-origin.`);
