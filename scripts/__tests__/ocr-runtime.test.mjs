import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import sharp from "sharp";
import { createWorker, OEM, PSM } from "tesseract.js";

const require = createRequire(import.meta.url);
const language = require("@tesseract.js-data/eng");

test("OCR worker loads local WASM/language and recognizes synthetic receipt text", { timeout: 45000 }, async () => {
  // All worker/core/language files resolve from the lockfile install. No CDN,
  // application providers, database, receipt files or real user data are used.
  const image = await sharp(Buffer.from('<svg width="700" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="25" y="105" font-family="sans-serif" font-size="80" fill="black">TOTAL 12345</text></svg>')).png().toBuffer();
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: language.langPath, gzip: language.gzip, cacheMethod: "none",
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const { data } = await worker.recognize(image);
    assert.match(data.text, /TOTAL\s+12345/);
    console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, sharp: sharp.versions.sharp, libvips: sharp.versions.vips, tesseract: require("tesseract.js/package.json").version, core: require("tesseract.js-core/package.json").version, language: require("@tesseract.js-data/eng/package.json").version, recognized: data.text.trim() }));
  } finally {
    await worker.terminate();
  }
});
