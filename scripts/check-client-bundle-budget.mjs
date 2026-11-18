#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const distRoot = path.resolve("dist/public");
const indexHtmlPath = path.join(distRoot, "index.html");
const budgetKb = Number(process.env.CLIENT_INITIAL_JS_GZIP_BUDGET_KB ?? "300");

if (!Number.isFinite(budgetKb) || budgetKb <= 0) {
  throw new Error(
    "CLIENT_INITIAL_JS_GZIP_BUDGET_KB must be a positive number when set"
  );
}

if (!fs.existsSync(indexHtmlPath)) {
  throw new Error(
    "dist/public/index.html is missing. Run `npm run build` before `npm run check:bundle`."
  );
}

const html = fs.readFileSync(indexHtmlPath, "utf8");
const initialAssetPattern =
  /<(?:script|link)\b(?=[^>]*(?:type="module"|rel="modulepreload"))[^>]+(?:src|href)="([^"]+\.js)"/g;
const staticImportPattern =
  /\b(?:import|export)\s+(?:[^'"]+?\s+from\s+)?["']([^"']+\.js)["']/g;

function normalizeAssetPath(assetPath) {
  return assetPath.replace(/^\//, "").replaceAll("\\", "/");
}

function resolveImport(fromAssetPath, specifier) {
  if (!specifier.startsWith(".")) {
    return normalizeAssetPath(specifier);
  }

  return path.posix.normalize(
    path.posix.join(path.posix.dirname(fromAssetPath), specifier)
  );
}

function readAsset(assetPath) {
  const absolutePath = path.join(distRoot, ...assetPath.split("/"));
  return fs.readFileSync(absolutePath);
}

function collectInitialAssets() {
  const pending = [
    ...html.matchAll(initialAssetPattern),
  ].map((match) => normalizeAssetPath(match[1]));
  const seen = new Set();

  for (let index = 0; index < pending.length; index += 1) {
    const assetPath = pending[index];
    if (seen.has(assetPath)) continue;
    seen.add(assetPath);

    const source = readAsset(assetPath).toString("utf8");
    for (const match of source.matchAll(staticImportPattern)) {
      pending.push(resolveImport(assetPath, match[1]));
    }
  }

  return [...seen].sort();
}

const assets = collectInitialAssets().map((assetPath) => {
  const raw = readAsset(assetPath);
  return {
    path: assetPath,
    rawBytes: raw.length,
    gzipBytes: zlib.gzipSync(raw).length,
  };
});

const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const budgetBytes = budgetKb * 1000;
const formatKb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

console.log("Client initial JS gzip budget");
console.log(`Budget: ${budgetKb.toFixed(2)} kB`);
console.log(`Total:  ${formatKb(totalGzipBytes)}`);
console.log("Assets:");
for (const asset of assets.sort((a, b) => b.gzipBytes - a.gzipBytes)) {
  console.log(
    `- ${asset.path} raw=${formatKb(asset.rawBytes)} gzip=${formatKb(
      asset.gzipBytes
    )}`
  );
}

if (totalGzipBytes > budgetBytes) {
  throw new Error(
    `Initial JS gzip ${formatKb(totalGzipBytes)} exceeds ${budgetKb.toFixed(
      2
    )} kB budget`
  );
}
