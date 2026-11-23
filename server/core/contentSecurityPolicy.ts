/**
 * Content-Security-Policy directives for production (helmet). Development
 * disables CSP, so a gap here only shows on a deployed site.
 */
export function buildCspDirectives(reportUri?: string) {
  return {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    // 'wasm-unsafe-eval' lets receipt OCR compile the self-hosted tesseract.js
    // WASM core (WebAssembly.instantiate). It does NOT allow eval() or
    // new Function(); never replace it with 'unsafe-eval'.
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    // The OCR worker runs from its same-origin URL (/ocr/worker.min.js,
    // workerBlobURL: false), so no blob: worker is needed.
    workerSrc: ["'self'"],
    // blob: is required: ProtectedImage loads /uploads/* with the session and
    // renders it through URL.createObjectURL (profile photos, banners, receipts).
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    // blob: is required: receipt OCR receives the protected receipt image as
    // an object URL and tesseract.js reads it with fetch(), which connect-src
    // governs. Only same-origin script can mint blob: URLs.
    connectSrc: ["'self'", "blob:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: [],
    // CSP violation reporting - set CSP_REPORT_URI to receive reports.
    ...(reportUri ? { reportUri: [reportUri] } : {}),
  };
}
