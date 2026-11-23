// Pure ESM compatibility: real production source, synthetic SDK, no app/DB/provider.
// Run with Node's --experimental-vm-modules flag; no selected SDK module is evaluated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const sources = {
  tracking: 'server/modules/ai/ai.tracking.ts',
  transport: 'server/modules/ai/ai.tracking-transport.ts',
  logger: 'server/utils/logger.ts',
  redaction: 'server/utils/log-redaction.ts',
};

async function fixture({ env = {}, initError, captureError, shutdownError, fetch: syntheticFetch } = {}) {
  const constructed = [], captured = [], logs = [];
  let shutdowns = 0;
  const context = vm.createContext({
    process: { env: { NODE_ENV: 'test', POSTHOG_API_KEY: 'synthetic-project-key', ...env } },
    console: Object.fromEntries(['log', 'warn', 'error', 'debug'].map(level => [level, value => logs.push({ level, value })])),
    fetch: syntheticFetch ?? (() => { throw new Error('Unexpected test transport; real network is unavailable'); }),
  });
  class SyntheticPostHog {
    constructor(key, options) {
      constructed.push({ key, options: { ...options } });
      if (initError) throw initError;
    }
    capture(payload) {
      if (captureError) throw captureError;
      captured.push(structuredClone(payload));
    }
    async shutdown() {
      shutdowns += 1;
      if (shutdownError) throw shutdownError;
    }
  }
  const sdk = new vm.SyntheticModule(['PostHog'], function () { this.setExport('PostHog', SyntheticPostHog); }, { context });
  const crypto = new vm.SyntheticModule(['randomUUID'], function () { this.setExport('randomUUID', randomUUID); }, { context });
  const modules = Object.fromEntries(Object.entries(sources).map(([name, relative]) => {
    const source = readFileSync(new URL(relative, root), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
      fileName: relative,
    }).outputText;
    return [name, new vm.SourceTextModule(output, { context, identifier: relative })];
  }));
  await modules.tracking.link(specifier => {
    if (specifier === 'posthog-node') return sdk;
    if (specifier === './ai.tracking-transport') return modules.transport;
    if (specifier === '../../utils/logger') return modules.logger;
    if (specifier === './log-redaction') return modules.redaction;
    if (specifier === 'crypto') return crypto;
    throw new Error(`Unexpected source import: ${specifier}`);
  });
  await modules.tracking.evaluate({ timeout: 1000 });
  return { service: modules.tracking.namespace.aiTracking, constructed, captured, logs, shutdowns: () => shutdowns,
    // The SDK's documented behavior uses options.fetch when set, otherwise global fetch.
    invokeFetch: (...args) => (constructed[0].options.fetch ?? context.fetch)(...args) };
}

const secret = 'raw-prompt person@example.invalid household-private-id query-private-hash';
const identity = { householdId: 'household-private-id', userId: 'user-private-id' };

test('configured analytics constructs once and emits the SDK aggregate capture object', async () => {
  const f = await fixture({ env: { POSTHOG_HOST: 'https://analytics.example.invalid' } });
  f.service.trackQuerySent({ ...identity, messageLength: 42, hasSessionContext: true });
  assert.equal(f.constructed.length, 1);
  assert.equal(f.constructed[0].key, 'synthetic-project-key');
  assert.equal(f.constructed[0].options.host, 'https://analytics.example.invalid');
  assert.equal(f.captured.length, 1, 'configured ESM analytics must capture instead of falling back from require');
  assert.deepEqual(f.captured[0], {
    distinctId: 'capital-ai-tracking', event: 'ai_query_sent',
    properties: { message_length: 42, has_session_context: true, timestamp: f.captured[0].properties.timestamp, environment: 'test', $process_person_profile: false },
  });
  assert.match(f.captured[0].properties.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('no key keeps logger fallback and explicit disabled tracking never constructs', async () => {
  const local = await fixture({ env: { POSTHOG_API_KEY: '' } });
  local.service.trackQuerySent({ ...identity, messageLength: 1, hasSessionContext: false });
  assert.equal(local.constructed.length, 0);
  assert.equal(local.captured.length, 0);
  assert.ok(local.logs.some(({ value }) => value.includes('Posthog not configured')));
  const disabled = await fixture({ env: { AI_TRACKING_ENABLED: 'false' } });
  disabled.service.trackQuerySent({ ...identity, messageLength: 1, hasSessionContext: false });
  await disabled.service.shutdown();
  assert.equal(disabled.constructed.length, 0);
  assert.equal(disabled.captured.length, 0);
  assert.equal(disabled.shutdowns(), 0);
  assert.deepEqual(disabled.logs, []);
});

test('capture v1 refuses before construction while ordinary v0 analytics remains functional', async () => {
  const unsupported = await fixture({ env: { POSTHOG_CAPTURE_MODE: 'v1' } });
  unsupported.service.trackQuerySent({ ...identity, messageLength: 1, hasSessionContext: false });
  assert.equal(unsupported.constructed.length, 0);
  assert.equal(unsupported.captured.length, 0);
  assert.ok(unsupported.logs.some(({ value }) => value.includes('Posthog capture mode v1 is unsupported')));
  const supported = await fixture({ env: { POSTHOG_CAPTURE_MODE: 'v0' } });
  supported.service.trackQuerySent({ ...identity, messageLength: 1, hasSessionContext: false });
  assert.equal(supported.constructed.length, 1);
  assert.equal(supported.captured.length, 1);
});

test('every event excludes raw identity, errors, hashes, names and unexpected nested properties', async () => {
  const f = await fixture({ env: { NODE_ENV: 'development' } });
  const common = { ...identity, unexpected: { prompt: secret } };
  f.service.trackQuerySent({ ...common, messageLength: 9, hasSessionContext: false });
  f.service.trackQuerySuccess({ ...common, toolsUsed: [secret], tokenCount: 12, latencyMs: 3.5, cacheHit: true, usedGemini: false });
  f.service.trackQueryFailed({ ...common, errorCode: secret, errorMessage: secret, latencyMs: 4 });
  f.service.trackConsentGranted({ ...common, consentVersion: secret, consentGiven: true });
  f.service.trackConsentRevoked({ ...common, consentVersion: secret, consentGiven: false });
  f.service.trackRateLimitHit({ ...common, remainingQueries: 0, resetTime: secret });
  f.service.trackCacheHit({ ...common, toolName: secret, queryHash: secret, hit: true });
  f.service.trackCacheMiss({ ...common, toolName: secret, queryHash: secret, hit: false });
  f.service.trackPromptInjectionBlocked({ ...common, ruleId: secret, messageLength: 10 });
  assert.deepEqual(f.captured.map(event => event.event), ['ai_query_sent', 'ai_query_success', 'ai_query_failed', 'ai_consent_granted', 'ai_consent_revoked', 'ai_rate_limit_hit', 'ai_cache_hit', 'ai_cache_miss', 'ai_prompt_injection_blocked']);
  const serialized = JSON.stringify({ captured: f.captured, logs: f.logs });
  for (const raw of [secret, identity.householdId, identity.userId]) assert.equal(serialized.includes(raw), false, raw);
  const allowed = new Set(['message_length', 'has_session_context', 'tool_count', 'token_count', 'latency_ms', 'cache_hit', 'used_gemini', 'remaining_queries', 'timestamp', 'environment', '$process_person_profile']);
  for (const { properties, distinctId } of f.captured) {
    assert.equal(distinctId, 'capital-ai-tracking');
    assert.equal(properties.$process_person_profile, false);
    for (const key of Object.keys(properties)) assert.ok(allowed.has(key), key);
  }
});

test('aggregate fields reject nonfinite, negative, oversized, wrongly typed and open labels', async () => {
  const f = await fixture({ env: { NODE_ENV: secret } });
  f.service.trackQuerySuccess({ ...identity, toolsUsed: [], tokenCount: Infinity, latencyMs: NaN, cacheHit: secret, usedGemini: 1 });
  f.service.trackQuerySent({ ...identity, messageLength: -1, hasSessionContext: 'false' });
  f.service.trackQuerySent({ ...identity, messageLength: Number.MAX_SAFE_INTEGER + 1, hasSessionContext: false });
  f.service.trackRateLimitHit({ ...identity, remainingQueries: 0.5, resetTime: secret });
  f.service.track('unreviewed_event', { user_id: secret, count: 1 });
  assert.equal(f.captured.length, 4);
  assert.equal(f.captured[0].properties.tool_count, 0);
  for (const { properties } of f.captured) {
    assert.equal(properties.environment, 'unknown');
    for (const key of ['token_count', 'latency_ms', 'message_length', 'remaining_queries']) assert.equal(key in properties, false, key);
  }
  assert.equal('cache_hit' in f.captured[0].properties, false);
  assert.equal('used_gemini' in f.captured[0].properties, false);
  assert.equal(f.captured[2].properties.has_session_context, false);
});

test('constructor, capture and async shutdown errors stay contained with static diagnostics', async () => {
  const init = await fixture({ initError: new Error(secret) });
  init.service.trackQueryFailed({ ...identity, errorCode: secret, errorMessage: secret, latencyMs: 1 });
  assert.equal(init.constructed.length, 1);
  assert.equal(init.captured.length, 0);
  assert.ok(init.logs.some(({ value }) => value.includes('Posthog initialization failed')));
  assert.equal(JSON.stringify(init.logs).includes(secret), false);
  const failed = await fixture({ captureError: new Error(secret), shutdownError: new Error(secret) });
  assert.doesNotThrow(() => failed.service.trackQuerySent({ ...identity, messageLength: 1, hasSessionContext: false }));
  await assert.doesNotReject(failed.service.shutdown());
  assert.equal(failed.shutdowns(), 1);
  assert.equal(failed.logs.filter(({ level }) => level === 'error').length, 2);
  assert.equal(JSON.stringify(failed.logs).includes(secret), false);
});

test('write-only transport preserves status/throttle but never exposes response payload or metadata', async () => {
  for (const status of [202, 429, 503]) {
    let cancelled = 0, bodyReads = 0, request;
    const signal = new AbortController().signal;
    const f = await fixture({ fetch: async (url, options) => {
      request = { url, options };
      return { status, statusText: secret, url: secret,
        headers: { get: () => '003', secret },
        text: async () => { bodyReads += 1; return secret; },
        json: async () => { bodyReads += 1; return { prompt: secret }; },
        body: { cancel: async () => { cancelled += 1; } } };
    } });
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'synthetic', signal };
    const response = await f.invokeFetch('https://analytics.example.invalid/batch', options);
    assert.equal(request.url, 'https://analytics.example.invalid/batch');
    assert.equal(request.options, options);
    assert.equal(request.options.signal, signal);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('retry-after'), '3');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await response.text(), '');
    assert.equal(JSON.stringify(await response.json()), '{}');
    assert.deepEqual(Object.keys(response).sort(), ['headers', 'json', 'status', 'text']);
    assert.equal(cancelled, 1);
    assert.equal(bodyReads, 0);
    assert.equal(JSON.stringify({ response, logs: f.logs }).includes(secret), false);
  }
});

test('transport drops malformed retry headers and contains sync/async cancellation errors', async () => {
  for (const raw of [secret, '-1', 'Infinity', '1.5', '0', '9'.repeat(100), null]) {
    const f = await fixture({ fetch: async () => ({ status: 429,
      headers: { get: () => raw }, body: { cancel: () => Promise.reject(new Error(secret)) },
      text: async () => secret, json: async () => { throw new Error(secret); } }) });
    const response = await f.invokeFetch('https://analytics.example.invalid/batch', { method: 'POST', headers: {} });
    assert.equal(response.headers.get('retry-after'), null);
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
  }
  const f = await fixture({ fetch: async () => ({ status: 503, headers: { get: () => '999999999' },
    body: { cancel: () => { throw new Error(secret); } } }) });
  const response = await f.invokeFetch('https://analytics.example.invalid/batch', { method: 'POST', headers: {} });
  assert.equal(response.headers.get('retry-after'), '300');
  assert.equal(JSON.stringify(f.logs).includes(secret), false);
});

test('network/response getter failures throw only a new static error without raw cause', async () => {
  const scenarios = [
    () => { throw new Error(secret, { cause: { secret } }); },
    async () => ({ get status() { throw new Error(secret); }, body: { cancel: async () => {} } }),
    async () => ({ status: 503, headers: { get() { throw new Error(secret); } }, body: { cancel: async () => {} } }),
    async () => ({ status: Infinity, headers: { get: () => null } }),
  ];
  for (const transport of scenarios) {
    const f = await fixture({ fetch: transport });
    await assert.rejects(async () => f.invokeFetch('https://analytics.example.invalid/batch', { method: 'POST', headers: {} }), error => {
      assert.equal(error.message, 'Posthog analytics transport failed');
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    });
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
  }
});
