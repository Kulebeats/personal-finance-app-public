/**
 * Self-hosted tesseract.js OCR runtime (OPS-004, slice R15.1).
 *
 * Receipt OCR runs in the browser. Left to its defaults, tesseract.js loads
 * its worker, WASM core and language data from a public CDN, which the
 * production Content-Security-Policy blocks. These same-origin URLs are
 * served from the lockfile-installed packages: by `vite-plugin-ocr-assets.ts`
 * in development and as emitted files in the production build.
 */
export const OCR_WORKER_PATH = "/ocr/worker.min.js";
export const OCR_CORE_PATH = "/ocr/core";
export const OCR_LANG_PATH = "/ocr/lang";

/**
 * Every served file and the installed package file it is copied from (a
 * path under node_modules). The worker picks one LSTM-only core by WASM
 * feature support, so all three variants are served. The language data is
 * the `4.0.0_best_int` model, the one tesseract.js uses for the LSTM engine.
 */
export const OCR_ASSET_FILES = [
  { url: OCR_WORKER_PATH, source: "tesseract.js/dist/worker.min.js" },
  { url: `${OCR_CORE_PATH}/tesseract-core-lstm.wasm.js`, source: "tesseract.js-core/tesseract-core-lstm.wasm.js" },
  { url: `${OCR_CORE_PATH}/tesseract-core-simd-lstm.wasm.js`, source: "tesseract.js-core/tesseract-core-simd-lstm.wasm.js" },
  { url: `${OCR_CORE_PATH}/tesseract-core-relaxedsimd-lstm.wasm.js`, source: "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js" },
  { url: `${OCR_LANG_PATH}/eng.traineddata.gz`, source: "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" },
] as const;
