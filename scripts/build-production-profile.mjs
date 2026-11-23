import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionProfile } from './production-profile/compile.mjs';

export { buildProductionProfile };

export async function writeProductionProfile({ outputDirectory, ...options }) {
  if (typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory)) {
    throw new Error('OUTPUT_DIRECTORY_REQUIRED: use an explicit absolute path');
  }
  const profile = await buildProductionProfile(options);
  await mkdir(outputDirectory, { recursive: false });
  try {
    for (const [relative, bytes] of profile.outputs) {
      const target = path.resolve(outputDirectory, ...relative.split('/'));
      const relativeTarget = path.relative(outputDirectory, target);
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
        throw new Error(`INVALID_OUTPUT_MAPPING: ${relative}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
  } catch (error) {
    throw new Error(`PROFILE_WRITE_REFUSED: ${error.message}`, { cause: error });
  }
  return profile.manifest;
}

function cliValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return undefined;
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((value, index) => !['--out', '--root'].includes(value) && args[index - 1] !== '--out' && args[index - 1] !== '--root');
  if (unknown.length || !cliValue(args, '--out')) {
    throw new Error('Usage: node scripts/build-production-profile.mjs --out <absent-absolute-directory> [--root <repository-root>]');
  }
  const root = path.resolve(cliValue(args, '--root') ?? process.cwd());
  const output = path.resolve(cliValue(args, '--out'));
  const manifest = await writeProductionProfile({ projectRoot: root, outputDirectory: output });
  process.stdout.write(`${manifest.graphSha256}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

