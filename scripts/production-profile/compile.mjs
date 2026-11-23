import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import * as esbuild from 'esbuild';
import {
  APPLICATION_ARTIFACT,
  APPLICATION_ENTRY,
  APPLICATION_GETTER_SPECIFIER,
  AUTHORITY_SOURCE_MODULES,
  PUBLIC_GETTER_SOURCE,
  PUBLIC_GETTER_STAGE_PATH,
  TRUSTED_ENTRY_POINTS,
  TRUSTED_MODULE_ALLOWLIST,
} from './constants.mjs';

const INTERNAL_IMPORT_CODE = /^(UNRESOLVED_INTERNAL_IMPORT|AMBIGUOUS_INTERNAL_IMPORT|SOURCE_OUTSIDE_ROOT|SYMLINKED_SOURCE|INVALID_SOURCE_PATH)$/;

function fail(code, detail = '') {
  const suffix = detail ? `: ${detail}` : '';
  throw new Error(`${code}${suffix}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourcePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    fail('INVALID_SOURCE_PATH', `${label} must be a repository-relative POSIX path`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail('INVALID_SOURCE_PATH', value);
  return parts.join('/');
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function repoFile(root, value, label = 'source') {
  const normalized = sourcePath(value, label);
  const absolute = path.resolve(root, ...normalized.split('/'));
  if (!within(root, absolute)) fail('SOURCE_OUTSIDE_ROOT', normalized);
  return { relative: normalized, absolute };
}

function stagePathFor(source) {
  const mapped = source.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/, '.mjs');
  const result = `.runtime/trusted/${mapped}`;
  sourcePath(result, 'stage mapping');
  return result;
}

function sourceHashRow(relative, bytes) {
  return { path: relative, sha256: sha256(bytes), sizeBytes: bytes.byteLength };
}

async function readPinnedSource(root, relative) {
  const located = repoFile(root, relative);
  let resolved;
  try { resolved = await realpath(located.absolute); }
  catch { fail('UNRESOLVED_INTERNAL_IMPORT', relative); }
  if (!within(root, resolved)) fail('SOURCE_OUTSIDE_ROOT', relative);
  if (path.resolve(resolved) !== path.resolve(located.absolute)) fail('SYMLINKED_SOURCE', relative);
  const info = await stat(resolved);
  if (!info.isFile()) fail('INVALID_SOURCE_PATH', `${relative} is not a file`);
  const bytes = await readFile(resolved);
  return { ...located, bytes, text: bytes.toString('utf8') };
}

function tsConfigOptions(root) {
  const configPath = path.join(root, 'tsconfig.json');
  let config;
  try {
    config = ts.readConfigFile(configPath, ts.sys.readFile);
  } catch (error) {
    fail('PRODUCTION_PROFILE_TSCONFIG_READ_FAILED', `${error?.code ?? 'read error'} at tsconfig.json`);
  }
  if (config.error) {
    const detail = ts.flattenDiagnosticMessageText(config.error.messageText, ' ');
    fail('PRODUCTION_PROFILE_TSCONFIG_READ_FAILED', `TS${config.error.code}: ${detail}`);
  }
  let parsed;
  try {
    parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  } catch (error) {
    fail('PRODUCTION_PROFILE_TSCONFIG_INVALID', `${error?.message ?? 'parse error'} at tsconfig.json`);
  }
  if (parsed.errors.length) {
    const details = parsed.errors.map(diagnostic => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`).join('; ');
    fail('PRODUCTION_PROFILE_TSCONFIG_INVALID', details);
  }
  return parsed.options;
}

function matchesPathAlias(specifier, paths = {}) {
  return Object.keys(paths).some(pattern => {
    const star = pattern.indexOf('*');
    if (star < 0) return specifier === pattern;
    return specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
  });
}

function moduleCandidates(base, extension) {
  const discoveredExt = path.extname(base).toLowerCase();
  const ext = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json', '.node'].includes(discoveredExt) ? discoveredExt : '';
  const substitutions = ext === '.js' ? ['.ts', '.tsx', '.mts', '.js']
    : ext === '.mjs' ? ['.mts', '.mjs']
      : ext === '.jsx' ? ['.tsx', '.jsx']
        : ext ? [ext] : ['.ts', '.mts', '.mjs', '.js', '.tsx', '.cjs'];
  const exact = ext ? [base] : [];
  const files = [...new Set([...substitutions.map(suffix => `${base.slice(0, base.length - ext.length)}${suffix}`), ...exact])];
  return ext ? files : [...files, ...['.ts', '.mts', '.mjs', '.js'].map(suffix => path.join(base, `index${suffix}`))];
}

async function chooseInternal(root, importer, specifier, options) {
  const alias = matchesPathAlias(specifier, options.paths);
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier) && !alias) return null;

  let candidates;
  if (alias) {
    const resolved = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
    candidates = resolved ? [resolved] : [];
  } else {
    if (path.isAbsolute(specifier)) fail('INVALID_SOURCE_PATH', `absolute import ${specifier}`);
    const base = path.resolve(path.dirname(importer), specifier);
    candidates = moduleCandidates(base);
  }

  const existing = [];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) existing.push(path.resolve(candidate));
    } catch { /* candidate does not exist */ }
  }
  const distinct = [...new Set(existing)];
  if (distinct.length > 1) fail('AMBIGUOUS_INTERNAL_IMPORT', `${specifier} from ${path.relative(root, importer)}`);
  if (distinct.length === 0) fail('UNRESOLVED_INTERNAL_IMPORT', `${specifier} from ${path.relative(root, importer)}`);
  const target = distinct[0];
  if (!within(root, target)) fail('SOURCE_OUTSIDE_ROOT', `${specifier} from ${path.relative(root, importer)}`);
  const real = await realpath(target);
  if (path.resolve(real) !== target) fail('SYMLINKED_SOURCE', path.relative(root, target));
  return target;
}

function loaderFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  fail('UNSUPPORTED_TRUSTED_FORMAT', `${file} (${ext || 'no extension'})`);
}

function applicationLoaderFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx',
    '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx',
    '.json': 'json', '.css': 'css', '.txt': 'text', '.wasm': 'wasm',
    '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.gif': 'file', '.svg': 'file',
  })[ext];
}

function parseSource(source, file) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    ['.js', '.mjs', '.cjs', '.jsx'].includes(path.extname(file).toLowerCase()) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
}

function stringModuleSpecifier(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function collectImports(source, file) {
  const fileAst = parseSource(source, file);
  const imports = [];
  const push = (specifierNode, kind, typeOnly = false) => {
    const specifier = stringModuleSpecifier(specifierNode);
    if (specifier === null) fail('NONLITERAL_DYNAMIC_IMPORT', `${file}:${specifierNode.getStart(fileAst)}`);
    imports.push({ specifier, kind, typeOnly, start: specifierNode.getStart(fileAst), end: specifierNode.getEnd() });
  };
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        push(node.moduleSpecifier, 'import', Boolean(node.importClause?.isTypeOnly));
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      push(node.moduleSpecifier, 'export', Boolean(node.isTypeOnly));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
        fail('NONLITERAL_DYNAMIC_IMPORT', `${file}:${node.getStart(fileAst)}`);
      }
      push(node.arguments[0], 'dynamic-import');
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
        fail('NONLITERAL_INTERNAL_REQUIRE', `${file}:${node.getStart(fileAst)}`);
      }
      push(node.arguments[0], 'require');
    }
    ts.forEachChild(node, visit);
  };
  visit(fileAst);
  return imports;
}

function collectDynamicImports(source, file) {
  const fileAst = parseSource(source, file);
  const imports = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
        fail('NONLITERAL_DYNAMIC_IMPORT', `${file}:${node.getStart(fileAst)}`);
      }
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(fileAst);
  return imports;
}

function sourceFormat(file) {
  return ['.ts', '.mts', '.cts', '.tsx'].includes(path.extname(file).toLowerCase()) ? 'typescript' : 'javascript';
}

function quoteSpecifier(specifier, original) {
  const quote = original[0];
  const escaped = specifier.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

function relativeStageSpecifier(importerStage, targetStage) {
  const relative = path.posix.relative(path.posix.dirname(importerStage), targetStage);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function rewriteImports(source, imports, importer, stageBySource, resolvedBySpecifier) {
  const edits = [];
  for (const edge of imports) {
    if (edge.typeOnly) continue;
    const target = resolvedBySpecifier.get(edge.specifier);
    if (!target) continue;
    if (edge.kind === 'require') fail('UNSUPPORTED_INTERNAL_REQUIRE', `${edge.specifier} from ${importer}`);
    const targetStage = stageBySource.get(target);
    if (!targetStage) fail('UNDECLARED_TRUSTED_MEMBER', target);
    const importerStage = stageBySource.get(importer);
    const rewritten = relativeStageSpecifier(importerStage, targetStage);
    edits.push({ start: edge.start, end: edge.end, text: quoteSpecifier(rewritten, source.slice(edge.start, edge.end)) });
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

function importRecord(parent, edge, targetStage, emittedSpecifier) {
  return {
    parent,
    specifier: targetStage === undefined ? edge.specifier : emittedSpecifier,
    target: targetStage ?? null,
    kind: edge.kind,
    external: targetStage === undefined,
    ...(edge.typeOnly ? { typeOnly: true } : {}),
  };
}

function outputImports(output) {
  return (output.imports ?? []).map(item => ({
    parent: APPLICATION_ARTIFACT,
    specifier: item.path,
    target: item.path === APPLICATION_GETTER_SPECIFIER ? PUBLIC_GETTER_STAGE_PATH : null,
    kind: item.kind,
    external: item.external,
  })).sort((a, b) => `${a.specifier}:${a.kind}`.localeCompare(`${b.specifier}:${b.kind}`));
}

function metafileInputAbsolute(root, input) {
  const absolute = path.resolve(root, input.replaceAll('/', path.sep));
  if (!within(root, absolute)) fail('SOURCE_OUTSIDE_ROOT', input);
  return absolute;
}

async function compileApplication(root, entry, getterAbsolute, authorityFiles, inputSnapshotObserver) {
  const entryFile = await readPinnedSource(root, entry);
  const aliases = tsConfigOptions(root).paths;
  if (inputSnapshotObserver !== undefined && typeof inputSnapshotObserver !== 'function') {
    fail('INVALID_INPUT_SNAPSHOT_OBSERVER', 'expected a function');
  }
  const authorityHashes = new Map();
  for (const relative of authorityFiles) {
    const file = await readPinnedSource(root, relative);
    authorityHashes.set(relative, sha256(file.bytes));
  }
  const sourceSnapshots = new Map();
  const build = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entryFile.absolute],
    outfile: path.join(root, APPLICATION_ARTIFACT),
    bundle: true,
    splitting: false,
    platform: 'node',
    packages: 'external',
    format: 'esm',
    target: 'node24',
    treeShaking: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'production-profile-public-getter',
      setup(context) {
        context.onResolve({ filter: /.*/ }, async args => {
          if (args.kind === 'entry-point' || (!args.path.startsWith('.') && !path.isAbsolute(args.path))) return;
          const mayNameGetter = /(?:^|\/)production-slot(?:\.mjs)?$/.test(args.path) || matchesPathAlias(args.path, aliases);
          if (!mayNameGetter) return undefined;
          try {
            const resolved = await chooseInternal(root, path.resolve(args.resolveDir || root, '__profile_importer__.mjs'), args.path, tsConfigOptions(root));
            if (resolved && path.resolve(resolved) === path.resolve(getterAbsolute)) {
              return { path: APPLICATION_GETTER_SPECIFIER, external: true };
            }
          } catch (error) {
            if (INTERNAL_IMPORT_CODE.test(String(error?.message))) return { errors: [{ text: error.message }] };
            throw error;
          }
          return undefined;
        });
        context.onLoad({ filter: /.*/ }, async args => {
          if (args.namespace !== 'file') return undefined;
          const absolute = path.resolve(args.path);
          if (!within(root, absolute)) return undefined;
          const relative = path.relative(root, absolute).split(path.sep).join('/');
          const file = await readPinnedSource(root, relative);
          const loader = applicationLoaderFor(relative);
          if (!loader) return undefined;
          const bytes = Buffer.from(file.bytes);
          sourceSnapshots.set(absolute, bytes);
          if (inputSnapshotObserver) {
            await inputSnapshotObserver(Object.freeze({
              path: relative,
              sha256: sha256(bytes),
              sizeBytes: bytes.byteLength,
            }));
          }
          return { contents: bytes, loader, resolveDir: path.dirname(absolute) };
        });
      },
    }],
  });
  const jsOutputs = Object.entries(build.metafile.outputs).filter(([name]) => name.endsWith('.js'));
  if (jsOutputs.length !== 1 || build.outputFiles.length !== 1) fail('APPLICATION_OUTPUT_SHAPE', `expected one JS output, got ${jsOutputs.length}`);
  const [outputName, outputMeta] = jsOutputs[0];
  const outputBytes = build.outputFiles[0].contents;
  const emittedImports = outputImports(outputMeta);
  const getterEdges = emittedImports.filter(edge => edge.specifier === APPLICATION_GETTER_SPECIFIER);
  if (getterEdges.length !== 1) fail('PUBLIC_GETTER_EDGE_COUNT', `expected exactly one fixed getter edge, got ${getterEdges.length}`);

  const authoritySet = new Set(authorityFiles.map(value => path.resolve(root, ...sourcePath(value, 'authority').split('/'))));
  const appInputs = [];
  const appInputFiles = new Set();
  const appInputRows = [];
  for (const [inputName, details] of Object.entries(build.metafile.inputs)) {
    const absolute = metafileInputAbsolute(root, inputName);
    const inputBytes = sourceSnapshots.get(absolute);
    if (!inputBytes) fail('UNBOUND_COMPILER_INPUT', inputName);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (inputBytes.byteLength !== details.bytes) fail('COMPILER_INPUT_SIZE_MISMATCH', relative);
    const hash = sha256(inputBytes);
    if (authoritySet.has(absolute) || [...authorityHashes.values()].includes(hash)) {
      fail('DUPLICATED_AUTHORITY', `${relative} is present in the bundled application`);
    }
    appInputFiles.add(absolute);
    appInputs.push({ ...sourceHashRow(relative, inputBytes), format: sourceFormat(relative), imports: details.imports.length });
    appInputRows.push({ absolute, relative, text: inputBytes.toString('utf8') });
  }
  const appOptions = tsConfigOptions(root);
  for (const input of appInputRows) {
    for (const specifier of collectDynamicImports(input.text, input.relative)) {
      const target = await chooseInternal(root, input.absolute, specifier, appOptions);
      if (target && !appInputFiles.has(path.resolve(target))) {
        fail('UNDECLARED_APPLICATION_DYNAMIC_MEMBER', `${specifier} from ${input.relative}`);
      }
    }
  }
  appInputs.sort((a, b) => a.path.localeCompare(b.path));
  const entryBytes = sourceSnapshots.get(entryFile.absolute);
  if (!entryBytes) fail('UNBOUND_COMPILER_INPUT', entryFile.relative);
  return {
    bytes: outputBytes,
    row: {
      source: { ...sourceHashRow(entryFile.relative, entryBytes), format: sourceFormat(entryFile.relative) },
      inputs: appInputs,
      stagePath: APPLICATION_ARTIFACT,
      format: 'esm',
      output: { sha256: sha256(outputBytes), sizeBytes: outputBytes.byteLength },
      imports: emittedImports,
      esbuildOutputPath: path.relative(root, path.resolve(root, outputName)).split(path.sep).join('/'),
    },
  };
}

async function trustedGraph(root, entryPoints, declaredMembers) {
  const options = tsConfigOptions(root);
  const queue = entryPoints.map(value => repoFile(root, value, 'trusted entry').absolute);
  const files = new Map();
  const parsed = new Map();
  const aliasesByImporter = new Map();
  while (queue.length) {
    const absolute = path.resolve(queue.shift());
    if (files.has(absolute)) continue;
    if (!within(root, absolute)) fail('SOURCE_OUTSIDE_ROOT', absolute);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const file = await readPinnedSource(root, relative);
    const imports = collectImports(file.text, relative);
    files.set(absolute, file);
    const edges = [];
    const bySpecifier = new Map();
    for (const edge of imports) {
      if (edge.typeOnly) continue;
      let target;
      try {
        target = await chooseInternal(root, absolute, edge.specifier, options);
      } catch (error) {
        throw error;
      }
      if (target) {
        if (edge.kind === 'require') fail('UNSUPPORTED_INTERNAL_REQUIRE', `${edge.specifier} from ${relative}`);
        const targetRelative = path.relative(root, target).split(path.sep).join('/');
        edges.push({ sourceSpecifier: edge.specifier, sourceTarget: target, sourcePath: targetRelative, sourceKind: edge.kind });
        bySpecifier.set(edge.specifier, target);
        queue.push(target);
      } else {
        edges.push(importRecord(stagePathFor(relative), edge, undefined));
      }
    }
    parsed.set(absolute, { imports, edges });
    aliasesByImporter.set(absolute, bySpecifier);
  }

  const sources = [...files.keys()].sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
  const stageBySource = new Map(sources.map(absolute => [absolute, stagePathFor(path.relative(root, absolute).split(path.sep).join('/'))]));
  const outputs = new Map();
  for (const [absolute, mapped] of stageBySource) {
    const fold = mapped.toLowerCase();
    const previous = outputs.get(fold);
    if (previous) fail('OUTPUT_PATH_COLLISION', `${previous} and ${mapped}`);
    outputs.set(fold, mapped);
  }
  if (declaredMembers) {
    const expected = new Set(declaredMembers.map(value => sourcePath(value, 'declared member')));
    const actual = new Set(sources.map(value => path.relative(root, value).split(path.sep).join('/')));
    const missing = [...actual].filter(value => !expected.has(value));
    const stale = [...expected].filter(value => !actual.has(value));
    if (missing.length || stale.length) fail('UNDECLARED_TRUSTED_MEMBER', `discovered=[${missing.join(',')}], declared-but-absent=[${stale.join(',')}]`);
  }

  const members = [];
  const compiledFiles = new Map();
  for (const absolute of sources) {
    const file = files.get(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const mapping = stageBySource.get(absolute);
    const { imports } = parsed.get(absolute);
    const rewrittenSource = rewriteImports(file.text, imports, absolute, stageBySource, aliasesByImporter.get(absolute));
    const transformed = await esbuild.transform(rewrittenSource, {
      loader: loaderFor(relative),
      sourcefile: relative,
      format: 'esm',
      target: 'node24',
      legalComments: 'none',
    });
    const outputBytes = Buffer.from(transformed.code, 'utf8');
    compiledFiles.set(mapping, outputBytes);
    const mappedImports = [];
    for (const edge of imports) {
      if (edge.typeOnly) continue;
      const target = aliasesByImporter.get(absolute).get(edge.specifier);
      const targetStage = target ? stageBySource.get(target) : undefined;
      const emittedSpecifier = targetStage === undefined ? undefined : relativeStageSpecifier(mapping, targetStage);
      mappedImports.push(importRecord(mapping, edge, targetStage, emittedSpecifier));
    }
    members.push({
      source: { ...sourceHashRow(relative, file.bytes), format: sourceFormat(relative) },
      stagePath: mapping,
      format: 'esm',
      output: { sha256: sha256(outputBytes), sizeBytes: outputBytes.byteLength },
      imports: mappedImports.sort((a, b) => `${a.specifier}:${a.kind}`.localeCompare(`${b.specifier}:${b.kind}`)),
    });
  }
  const roots = entryPoints.map(value => {
    const relative = sourcePath(value, 'trusted entry');
    const absolute = path.resolve(root, ...relative.split('/'));
    return { sourcePath: relative, stagePath: stageBySource.get(absolute) };
  });
  return { members, outputs: compiledFiles, roots };
}

/** Build into memory only. This compiles source; it does not load or evaluate the result. */
export async function buildProductionProfile(options = {}) {
  const root = await realpath(path.resolve(options.projectRoot ?? process.cwd()));
  const entry = sourcePath(options.applicationEntry ?? APPLICATION_ENTRY, 'application entry');
  const getter = sourcePath(options.publicGetterSource ?? PUBLIC_GETTER_SOURCE, 'public getter');
  const trustedEntries = (options.trustedEntries ?? TRUSTED_ENTRY_POINTS).map(value => sourcePath(value, 'trusted entry'));
  const authorityFiles = (options.authorityModules ?? AUTHORITY_SOURCE_MODULES).map(value => sourcePath(value, 'authority module'));
  const getterFile = await readPinnedSource(root, getter);
  const app = await compileApplication(root, entry, getterFile.absolute, authorityFiles, options.onApplicationInputSnapshot);
  const declaredMembers = options.declaredTrustedMembers ?? TRUSTED_MODULE_ALLOWLIST;
  const trusted = await trustedGraph(root, trustedEntries, declaredMembers);
  const expectedGetterStage = stagePathFor(getter);
  if (expectedGetterStage !== PUBLIC_GETTER_STAGE_PATH && options.publicGetterSource === undefined) fail('INVALID_GETTER_MAPPING', expectedGetterStage);
  const getterMemberCount = trusted.members.filter(member => member.stagePath === PUBLIC_GETTER_STAGE_PATH).length;
  if (getterMemberCount !== 1) fail('PUBLIC_GETTER_MEMBER_COUNT', `expected one ${PUBLIC_GETTER_STAGE_PATH}, got ${getterMemberCount}`);
  const base = {
    schemaVersion: 1,
    application: app.row,
    trustedGraph: {
      roots: trusted.roots,
      members: trusted.members.sort((a, b) => a.stagePath.localeCompare(b.stagePath)),
    },
    provenance: {
      compiler: 'esbuild',
      compilerVersion: esbuild.version,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      applicationEntry: entry,
      applicationBundle: true,
      trustedModulesBundled: false,
      splitting: false,
      target: 'node24',
    },
  };
  const manifest = { ...base, graphSha256: sha256(stable(base)) };
  const outputs = new Map(trusted.outputs);
  outputs.set(APPLICATION_ARTIFACT, app.bytes);
  outputs.set('.runtime/production-profile.json', Buffer.from(`${stable(manifest)}\n`, 'utf8'));
  return Object.freeze({ manifest, outputs });
}

