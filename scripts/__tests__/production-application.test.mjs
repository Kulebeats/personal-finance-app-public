// Exercises real entry sources with synthetic dependencies. No app, DB or network is loaded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);

async function fixture({ ordinary = false, directoryExists = true, startupError } = {}) {
  const events = [], uses = [], checked = [];
  const context = vm.createContext({});
  const directory = path.resolve('synthetic-build');
  const staticHandler = () => {};
  let setup;
  const synthetic = (name, values, onEvaluate = () => {}) => new vm.SyntheticModule(Object.keys(values), function () {
    onEvaluate();
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context, identifier: name });
  const dependencies = {
    'dotenv/config': synthetic('dotenv', {}, () => events.push('dotenv')),
    'node:fs': synthetic('fs', { default: { existsSync: value => { checked.push(value); return directoryExists; } } }),
    'node:path': synthetic('path', { default: path }),
    express: synthetic('express', { default: { static: value => { events.push(['static', value]); return staticHandler; } } }),
    './app': synthetic('app', { default: async callback => {
      events.push('start'); setup = callback;
      if (startupError) throw startupError;
    } }, () => events.push('app-evaluation')),
  };
  const source = relative => new vm.SourceTextModule(ts.transpileModule(readFileSync(new URL(relative, root), 'utf8'), {
    fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, { context, identifier: relative, initializeImportMeta: meta => { meta.dirname = directory; } });
  const application = source('server/production-application.ts');
  const entry = ordinary ? source('server/index-prod.ts') : application;
  await entry.link(specifier => {
    if (specifier === './production-application') return application;
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    return dependencies[specifier];
  });
  await entry.evaluate({ timeout: 1000 });
  return { application: application.namespace, entry: entry.namespace, events, checked, directory, staticHandler,
    uses, app: { use: (...args) => uses.push(args) }, setup: () => setup };
}

test('application entry exports startup without automatic start or a direct dotenv import', async () => {
  const f = await fixture();
  // App dependencies are synthetic here. The real app graph remains effectful,
  // including db.ts importing dotenv; the artifact is imported only AFTER admission.
  assert.deepEqual(f.events, ['app-evaluation']);
  assert.equal(typeof f.application.startApplication, 'function');
  await f.application.startApplication();
  assert.deepEqual(f.events, ['app-evaluation', 'start']);
  assert.equal(f.setup(), f.application.serveStatic);
});

test('explicit startup propagates application initialization failure', async () => {
  const error = new Error('synthetic startup failure');
  const f = await fixture({ startupError: error });
  await assert.rejects(f.application.startApplication(), caught => caught === error);
});

test('ordinary production entry loads dotenv first and automatically starts once', async () => {
  const f = await fixture({ ordinary: true });
  assert.deepEqual(f.events, ['dotenv', 'app-evaluation', 'start']);
  assert.equal(f.entry.serveStatic, f.application.serveStatic);
  assert.equal(f.setup(), f.application.serveStatic);
});

test('static assets and SPA fallback use public next to the emitted application', async () => {
  const f = await fixture();
  await f.application.serveStatic(f.app, {});
  const publicPath = path.join(f.directory, 'public');
  assert.deepEqual(f.checked, [publicPath]);
  assert.deepEqual(f.events, ['app-evaluation', ['static', publicPath]]);
  assert.equal(f.uses.length, 2);
  assert.deepEqual(f.uses[0], [f.staticHandler]);
  assert.equal(f.uses[1][0], '*');
  let sent;
  f.uses[1][1]({}, { sendFile: file => { sent = file; } });
  assert.equal(sent, path.join(publicPath, 'index.html'));
});

test('missing client build rejects before registering any route', async () => {
  const f = await fixture({ directoryExists: false });
  await assert.rejects(f.application.serveStatic(f.app, {}), /Could not find the build directory/);
  assert.equal(f.uses.length, 0);
  assert.deepEqual(f.events, ['app-evaluation']);
});
