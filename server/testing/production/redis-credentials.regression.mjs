import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { manifestFixture, approvedFixturePins } from './manifest.fixture.mjs';
import { createRedisCredentials, withRedisProvisioningSecret, bindRedisCredentials, requireRedisCredentials,
  withRedisConnectionSecret, onRedisCredentialsRevoked } from './redis-credentials.mjs';

// Self-consistent inert declarations exercise credential state only; no service/dispatch provenance.
function declaration() {
  const document = manifestFixture(); document.redis.credentialGeneration = randomUUID();
  const pins = { ...approvedFixturePins, expectedManifestSha256: digest(canonicalJson(document)),
    expectedServicesSha256: digest(canonicalJson({ endpoints: document.endpoints, postgres: document.postgres, redis: document.redis })) };
  return readProductionManifest(canonicalJson(document), pins);
}
const refusal = /REDIS_CREDENTIALS_REFUSED:/;

test('credential creation consumes the actual manifest brand without observing services', () => {
  const manifest = declaration();
  for (const fake of [null, {}, manifest.document, structuredClone(manifest), new Proxy(manifest, {})]) {
    assert.throws(() => createRedisCredentials(fake), refusal);
  }
  const { capability, owner } = createRedisCredentials(manifest);
  assert.equal(Object.isFrozen(capability), true); assert.equal(Object.getPrototypeOf(capability), null);
  assert.deepEqual(Reflect.ownKeys(capability), []); assert.deepEqual(Reflect.ownKeys(owner), ['revoke']);
  owner.revoke();
});

test('fresh private material is scoped to the manifest generation and excluded from public handles', async () => {
  const first = createRedisCredentials(declaration()), second = createRedisCredentials(declaration());
  let firstSecret, secondSecret;
  assert.equal(await withRedisProvisioningSecret(first.capability, async secret => { firstSecret = secret; return 'provisioned'; }), 'provisioned');
  await withRedisProvisioningSecret(second.capability, async secret => { secondSecret = secret; });
  assert.match(firstSecret, /^[A-Za-z0-9_-]{43}$/); assert.match(secondSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstSecret, secondSecret);
  assert.equal(JSON.stringify(first).includes(firstSecret), false);
  assert.throws(() => { first.capability.secret = firstSecret; }, TypeError);
  first.owner.revoke(); second.owner.revoke();
});

test('the same run/ref/generation cannot issue twice, including after revocation', () => {
  const manifest = declaration(), issued = createRedisCredentials(manifest);
  assert.throws(() => createRedisCredentials(manifest), /REDIS_CREDENTIALS_REFUSED:DUPLICATE/);
  issued.owner.revoke();
  assert.throws(() => createRedisCredentials(manifest), /REDIS_CREDENTIALS_REFUSED:DUPLICATE/);
});

test('forged or serialized capabilities cannot run secret callbacks or admit a connection', async () => {
  const issued = createRedisCredentials(declaration()); let calls = 0;
  for (const fake of [null, {}, structuredClone(issued.capability), new Proxy(issued.capability, {})]) {
    await assert.rejects(withRedisProvisioningSecret(fake, async () => { calls++; }), refusal);
    await assert.rejects(withRedisConnectionSecret(fake, {}, async () => { calls++; }), refusal);
    await assert.rejects(bindRedisCredentials(fake, {}), refusal);
    assert.throws(() => requireRedisCredentials(fake, {}), refusal);
    assert.throws(() => onRedisCredentialsRevoked(fake, () => { calls++; }), refusal);
  }
  assert.equal(calls, 0); issued.owner.revoke();
});

test('provisioning is exclusive and an unbound capability never admits app connection callbacks', async () => {
  const issued = createRedisCredentials(declaration()); let release, calls = 0;
  const pending = withRedisProvisioningSecret(issued.capability, () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(withRedisProvisioningSecret(issued.capability, async () => { calls++; }), /REDIS_CREDENTIALS_REFUSED:PHASE/);
  await assert.rejects(bindRedisCredentials(issued.capability, {}), /REDIS_CREDENTIALS_REFUSED:PHASE/);
  await assert.rejects(withRedisConnectionSecret(issued.capability, {}, async () => { calls++; }), refusal);
  assert.throws(() => requireRedisCredentials(issued.capability, {}), refusal);
  release('done'); assert.equal(await pending, 'done'); assert.equal(calls, 0); issued.owner.revoke();
});

test('revocation immediately fans out and fences provisioning already awaiting a result', async () => {
  const issued = createRedisCredentials(declaration()); let release, observed = false;
  onRedisCredentialsRevoked(issued.capability, () => {
    assert.throws(() => requireRedisCredentials(issued.capability, {}), refusal); observed = true;
  });
  const pending = withRedisProvisioningSecret(issued.capability, () => new Promise(resolve => { release = resolve; }));
  issued.owner.revoke(); assert.equal(observed, true); release('late success');
  await assert.rejects(pending, /REDIS_CREDENTIALS_REFUSED:REVOKED/);
  let calls = 0;
  await assert.rejects(withRedisProvisioningSecret(issued.capability, async () => { calls++; }), refusal);
  assert.equal(calls, 0); issued.owner.revoke();
});

test('callback failures never echo secret-bearing error text or causes', async () => {
  const issued = createRedisCredentials(declaration()); let secret;
  await assert.rejects(withRedisProvisioningSecret(issued.capability, async value => {
    secret = value; throw new Error(`private material ${value}`);
  }), error => {
    assert.equal(error.message, 'REDIS_CREDENTIALS_REFUSED:ACTION');
    assert.equal(error.cause, undefined); assert.equal(String(error.stack).includes(secret), false); return true;
  });
  issued.owner.revoke();
});

test('revocation also fences a late rejected provisioning action without exposing its error', async () => {
  const issued = createRedisCredentials(declaration()); let reject;
  const pending = withRedisProvisioningSecret(issued.capability, () => new Promise((_resolve, failure) => { reject = failure; }));
  issued.owner.revoke(); reject(new Error('late private provisioning error'));
  await assert.rejects(pending, error => {
    assert.equal(error.message, 'REDIS_CREDENTIALS_REFUSED:REVOKED'); assert.equal(error.cause, undefined); return true;
  });
});

test('invalid provisioning callback refuses before taking the exclusive provisioning slot', async () => {
  const issued = createRedisCredentials(declaration());
  await assert.rejects(withRedisProvisioningSecret(issued.capability, null), /REDIS_CREDENTIALS_REFUSED:ACTION/);
  assert.equal(await withRedisProvisioningSecret(issued.capability, async () => 'still provisionable'), 'still provisionable');
  assert.throws(() => onRedisCredentialsRevoked(issued.capability, null), /REDIS_CREDENTIALS_REFUSED:OBSERVER/);
  issued.owner.revoke();
});

test('revocation subscribers unsubscribe independently, notify late subscribers, and retain failure visibility', () => {
  const issued = createRedisCredentials(declaration()), calls = [];
  const unsubscribe = onRedisCredentialsRevoked(issued.capability, () => calls.push('removed'));
  onRedisCredentialsRevoked(issued.capability, () => { calls.push('throwing'); throw new Error('observer private text'); });
  onRedisCredentialsRevoked(issued.capability, () => calls.push('last'));
  unsubscribe(); unsubscribe();
  assert.throws(() => issued.owner.revoke(), error => {
    assert.equal(error instanceof AggregateError, true); assert.equal(String(error).includes('observer private text'), false);
    assert.equal(error.errors.length, 1); assert.equal(error.errors[0].message, 'REDIS_CREDENTIALS_OBSERVER_FAILED'); return true;
  });
  assert.deepEqual(calls, ['throwing', 'last']);
  onRedisCredentialsRevoked(issued.capability, () => calls.push('late'));
  assert.deepEqual(calls, ['throwing', 'last', 'late']); issued.owner.revoke();
});

test('binding public JSON refuses and revokes without any fake issuer or admitted service', async () => {
  const manifest = declaration(), issued = createRedisCredentials(manifest); let revoked = false;
  onRedisCredentialsRevoked(issued.capability, () => { revoked = true; });
  // Missing producer and a real producer refusing JSON are both fail-closed here.
  // This is deliberately no positive service-brand/binding coverage.
  const publicReceipt = { kind: 'owned-redis-service', runId: manifest.document.runId, ...manifest.document.redis, verified: true };
  await assert.rejects(bindRedisCredentials(issued.capability, publicReceipt), /REDIS_CREDENTIALS_REFUSED:SERVICE/);
  assert.equal(revoked, true);
  await assert.rejects(withRedisProvisioningSecret(issued.capability, async () => 'must not run'), refusal);
});
