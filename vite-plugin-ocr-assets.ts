import type { Plugin } from "vite";
import fs from "fs";
import path from "path";
import { OCR_ASSET_FILES } from "./shared/ocrAssets";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".gz": "application/gzip",
};

interface ResolvedOcrAsset {
  url: string;
  absolutePath: string;
}

function resolveAssets(rootDir: string): ResolvedOcrAsset[] {
  return OCR_ASSET_FILES.map((file) => ({
    url: file.url,
    absolutePath: path.join(rootDir, "node_modules", ...file.source.split("/")),
  }));
}

/**
 * Serves the tesseract.js worker, WASM core and English language data
 * same-origin under /ocr/ (see shared/ocrAssets.ts). The production build
 * emits byte-for-byte copies of the lockfile-installed files; the dev server
 * streams them from node_modules. A missing file fails the build instead of
 * shipping an OCR feature that cannot start.
 */
export function ocrAssetsPlugin(rootDir: string): Plugin {
  const assets = resolveAssets(rootDir);
  const byUrl = new Map(assets.map((asset) => [asset.url, asset]));

  return {
    name: "vite-plugin-ocr-assets",
    buildStart() {
      const missing = assets.filter((asset) => !fs.existsSync(asset.absolutePath));
      if (missing.length > 0) {
        this.error(
          `OCR assets missing (run npm ci): ${missing.map((asset) => asset.absolutePath).join(", ")}`,
        );
      }
    },
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: "asset",
          fileName: asset.url.replace(/^\//, ""),
          source: fs.readFileSync(asset.absolutePath),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const asset = byUrl.get((req.url ?? "").split("?")[0]);
        if (!asset) {
          next();
          return;
        }
        res.setHeader("Content-Type", CONTENT_TYPES[path.extname(asset.url)] ?? "application/octet-stream");
        fs.createReadStream(asset.absolutePath).on("error", next).pipe(res);
      });
    },
  };
}
