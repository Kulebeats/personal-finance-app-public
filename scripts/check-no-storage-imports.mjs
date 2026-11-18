import { promises as fs } from "fs";
import path from "path";

const rootDir = process.cwd();
const allowlistPath = path.join(
  rootDir,
  "scripts",
  "storage-import-allowlist.txt"
);

const importRegex = /(?:^|\s)from\s+["']([^"']+)["']/gm;
const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/gm;
const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/gm;

const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const normalizePath = (filePath) => filePath.replace(/\\/g, "/");

const isStorageImport = (specifier) => {
  const normalized = specifier.replace(/\\/g, "/");
  return /(^|\/)storage(\.[jt]sx?)?$/.test(normalized);
};

const loadAllowlist = async () => {
  const contents = await fs.readFile(allowlistPath, "utf8");
  return new Set(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  );
};

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
};

const collectStorageImports = async () => {
  const targetDir = path.join(rootDir, "server");
  const files = await walk(targetDir);
  const storageImports = new Set();

  for (const file of files) {
    const contents = await fs.readFile(file, "utf8");
    const specifiers = [];

    for (const regex of [importRegex, requireRegex, dynamicImportRegex]) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(contents)) !== null) {
        specifiers.push(match[1]);
      }
    }

    if (specifiers.some(isStorageImport)) {
      storageImports.add(normalizePath(path.relative(rootDir, file)));
    }
  }

  return storageImports;
};

const main = async () => {
  const allowlist = await loadAllowlist();
  const storageImports = await collectStorageImports();
  const violations = [...storageImports].filter((file) => !allowlist.has(file));

  if (violations.length > 0) {
    console.error(
      "New storage imports detected. Please use repositories instead:"
    );
    for (const file of violations.sort()) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Storage import guard failed:", error);
  process.exit(1);
});
