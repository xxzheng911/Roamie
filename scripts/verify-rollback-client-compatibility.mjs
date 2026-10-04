import assert from 'node:assert/strict';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { googleRestRequest } from '../src/lib/google-rest-contract.ts';
import { signPlacePhoto } from '../src/lib/place-photo-signature.server.ts';
import { handlePlacePhotoRequest } from '../src/routes/api/place-photo.ts';
import { createMemoryAbuseGuard } from '../src/lib/abuse-guard-memory.ts';

const baseline = '6e8406ddf3ab457b6390ad65f334573933299d23';
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const envelope = { url: 'https://places.googleapis.com/v1/places:searchText', method: 'POST', body: { textQuery: 'Taipei' }, fieldMask: 'places.id' };
const legacy = googleRestRequest(envelope);
for (const client of ['Legacy Web', 'Current iOS']) check(client, () => assert.deepEqual(googleRestRequest(envelope), legacy));
for (const client of ['New Web', 'Future iOS']) for (const attemptKind of ['initial', 'retry', 'fallback', 'unknown']) {
  check(`${client}: ${attemptKind} ignored by provider authority`, () => assert.deepEqual(googleRestRequest({ ...envelope, attemptKind }), legacy));
}
for (const attemptKind of ['other', '', 0, true, null, [], { userId: 'injection' }]) check('invalid attemptKind rejected', () => assert.throws(() => googleRestRequest({ ...envelope, attemptKind })));
for (const extra of [{ unknown: 1 }, { userId: 'attacker' }, { operationId: 'replay' }]) check('unknown envelope field rejected', () => assert.throws(() => googleRestRequest({ ...envelope, ...extra })));
for (const change of [{ url: 'https://attacker.invalid/v1/places:searchText' }, { method: 'DELETE' }, { url: 'https://places.googleapis.com/v1/unsupported' }, { body: { textQuery: 'Taipei', unknown: true } }]) check('whitelists retained', () => assert.throws(() => googleRestRequest({ ...envelope, ...change, attemptKind: 'initial' })));

const secret = 'rollback-test-only-signing-secret-32-bytes';
const env = { PLACE_PHOTO_SIGNING_SECRET: secret, GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const photo = 'places/test-place/photos/test-photo';
const expires = Math.floor(Date.now() / 1000) + 600;
// Independent producer fixture: exact 11eff784 AES-GCM domain and HMAC wire protocol.
function principalFor(userId, signingSecret = secret) {
  const key = createHash('sha256').update(`roamie-photo-principal-v1:${signingSecret}`).digest();
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(userId, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url');
}
function newToken(principal = principalFor('test-user'), overrides = {}) {
  const x = { photo, w: 600, expires, aud: 'authenticated', principal, ...overrides };
  x.signature = createHmac('sha256', secret).update(`${x.photo}\n${x.w}\n${x.expires}\nauthenticated\n${x.principal}`).digest('base64url');
  return x;
}
let dispatches = 0;
async function run(name, params, status) {
  const before = dispatches;
  const response = await handlePlacePhotoRequest(new Request(`https://roamie.tw/api/place-photo?${new URLSearchParams(params)}`, { headers: { 'cf-connecting-ip': '198.51.100.2' } }), {
    fetch: async () => { dispatches++; return new Response(new Uint8Array([0xff,0xd8,0xff,0xd9]), { headers: { 'content-type': 'image/jpeg' } }); },
    resolveServerKey: () => ({ key: 'mock-server-key', source: 'GOOGLE_PLACES_SERVER_API_KEY' }),
    recordHttpCall: () => {}, timeoutMs: 1000,
  }, env);
  assert.equal(response.status, status, name);
  assert.equal(dispatches - before, status === 200 ? 1 : 0, `${name}: rejected capability never dispatches`);
  checks++; console.log('PASS', name);
}
const token = await signPlacePhoto(env, photo, 600);
const old = { photo, w: 600, ...token };
await run('legacy photo; baseline unset enforcement does not require DO', old, 200);
const guest = await signPlacePhoto(env, photo, 600, undefined, 'guest');
env.ABUSE_GUARD = createMemoryAbuseGuard().namespace;
await run('legacy guest photo retains guest budget path', { photo, w: 600, ...guest, aud: 'guest' }, 200);
delete env.ABUSE_GUARD;
const fresh = newToken();
await run('new authenticated photo; same baseline accounting', fresh, 200);
for (const [name, params, status] of [
  ['modified HMAC', { ...fresh, signature: 'tampered' }, 401],
  ['expired signed token', newToken(undefined, { expires: Math.floor(Date.now()/1000)-1 }), 401],
  ['wrong principal', { ...fresh, principal: principalFor('other-user') }, 401],
  ['malformed principal with valid HMAC', newToken('malformed'), 401],
  ['wrong AES key with valid HMAC', newToken(principalFor('user', 'different-key')), 401],
  ['empty subject with valid HMAC', newToken(principalFor('')), 401],
  ['oversized subject', newToken(principalFor('x'.repeat(129))), 401],
  ['new token downgraded to legacy', { ...fresh, aud: '', principal: '' }, 401],
  ['legacy signature attached to authenticated format', { ...fresh, signature: old.signature }, 401],
  ['unknown audience', { ...old, aud: 'unknown' }, 401],
  ['principal without audience', { ...old, principal: fresh.principal }, 401],
  ['modified width', { ...fresh, w: 601 }, 401],
  ['modified resource', { ...fresh, photo: photo+'x' }, 401],
  ['invalid resource with valid HMAC', newToken(undefined, { photo: '../invalid' }), 400],
]) await run(name, params, status);
const stripped = { ...fresh }; delete stripped.aud; delete stripped.principal;
await run('removed new format markers cannot downgrade', stripped, 401);
// The signer remains legacy: accepting new tokens must not change issued capabilities.
check('legacy signing payload unchanged', () => assert.equal(token.signature, createHmac('sha256',secret).update(`${photo}\n600\n${token.expires}`).digest('base64url')));
for (const path of ['src/lib/abuse-guard.server.ts','src/lib/abuse-guard-policy.ts','src/lib/abuse-guard-do.ts','src/lib/abuse-guard-logic.ts','src/lib/google-rest-provider.server.ts','src/routes/api/google.ts','src/routes/api/place-photo/sign.ts','wrangler.jsonc']) {
  check(`baseline behavior byte-identical: ${path}`, () => assert.equal(readFileSync(path,'utf8'), execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8'})));
}
const baselinePhoto = execFileSync('git', ['show', `${baseline}:src/routes/api/place-photo.ts`], { encoding: 'utf8' });
const patchedPhoto = readFileSync('src/routes/api/place-photo.ts', 'utf8');
check('photo rate/budget/upstream behavior unchanged after signature verification', () => assert.equal(patchedPhoto.slice(patchedPhoto.indexOf('  const observation = newGuardObservation')), baselinePhoto.slice(baselinePhoto.indexOf('  const observation = newGuardObservation'))));
console.log(`Rollback compatibility: ${checks} checks PASS`);
