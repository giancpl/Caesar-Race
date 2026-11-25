import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../../src/transport/api.js';
import { storage } from '../../src/transport/session.js';
const token = 'a'.repeat(43);
const room = { code: 'ABC234', raceId: 'a'.repeat(32), roomVersion: 1, serverNow: Date.now() };
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function session(pending) { return { token, code: room.code, ...(pending ? { pending } : {}) }; }

test('concurrent recovery retries one pending mutation once', async (t) => {
  const saved = session({ action: 'answer', body: { code: room.code, requestId: 'request-123456789', answer: 'Hello.' } });
  t.mock.method(storage, 'get', () => saved); t.mock.method(storage, 'set', () => {});
  const pending = deferred(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; await pending.promise; return Response.json({ ok: true, room, outcome: { correct: true } }); });
  const client = new RoomClient(); const a = client.recover(); const b = client.recover();
  assert.equal(a, b); pending.resolve(); const results = await Promise.all([a, b]);
  assert.equal(calls, 1); assert.equal(results[0].outcome.correct, true); assert.equal(client.session.pending, undefined);
});
test('an old response cannot clear or replace a newer session', async (t) => {
  t.mock.method(storage, 'get', () => session()); t.mock.method(storage, 'remove', () => {});
  const pending = deferred(); t.mock.method(globalThis, 'fetch', async () => { await pending.promise; return Response.json({ ok: true, room }); });
  const client = new RoomClient(); const result = client.status(); client.clear(); const replacement = session(); client.session = replacement;
  pending.resolve(); await assert.rejects(result, { code: 'SESSION_CHANGED' }); assert.equal(client.session, replacement);
});
test('creating or joining cannot overwrite an existing room identity', async (t) => {
  const saved = session();
  t.mock.method(storage, 'get', () => saved);
  const write = t.mock.method(storage, 'set', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  const client = new RoomClient();
  for (const action of ['create', 'join']) await assert.rejects(client.bootstrap(action, { code: 'XYZ234', name: 'Player' }), { code: 'SESSION_EXISTS' });
  assert.equal(client.session, saved); assert.equal(write.mock.calls.length, 0); assert.equal(fetch.mock.calls.length, 0);
});
test('old authorization failures cannot invalidate the replacement session', async (t) => {
  t.mock.method(storage, 'get', () => session()); t.mock.method(storage, 'remove', () => {});
  const pending = deferred();
  t.mock.method(globalThis, 'fetch', async () => { await pending.promise; return Response.json({ ok: false, error: 'INVALID_SESSION' }, { status: 401 }); });
  const client = new RoomClient(); const result = client.status(); client.clear(); const replacement = session(); client.session = replacement;
  pending.resolve(); await assert.rejects(result, { code: 'SESSION_CHANGED' }); assert.equal(client.session, replacement);
});
test('a lost join response survives reconstruction and retries the original identity', async (t) => {
  let saved = null; const calls = [];
  t.mock.method(storage, 'get', () => saved);
  t.mock.method(storage, 'set', (_key, value) => { saved = structuredClone(value); });
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => { calls.push(options); throw new TypeError('Disconnected'); });
  const first = new RoomClient();
  await assert.rejects(first.bootstrap('join', { code: room.code, name: 'Alice' }), { code: 'NETWORK_ERROR' });
  const second = new RoomClient();
  await assert.rejects(second.bootstrap('create', { name: 'BitPolito' }), { code: 'PENDING_REQUEST' });
  fetch.mock.mockImplementation(async (_url, options) => { calls.push(options); return Response.json({ ok: true, room }); });
  await second.recover();
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers.Authorization, calls[1].headers.Authorization);
  assert.equal(second.session.bootstrap, undefined); assert.equal(second.session.code, room.code);
});
test('uncertain failures retain a mutation, definite validation failures clear it', async (t) => {
  const saved = session({ action: 'answer', body: { requestId: 'request-123456789', answer: 'Hello.' } });
  t.mock.method(storage, 'get', () => saved); t.mock.method(storage, 'set', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: 'STORAGE_UNAVAILABLE' }, { status: 503 }));
  const client = new RoomClient(); await assert.rejects(client.recover(), { code: 'STORAGE_UNAVAILABLE' }); assert.ok(client.session.pending);
  fetch.mock.mockImplementation(async () => Response.json({ ok: false, error: 'INVALID_ANSWER' }, { status: 400 }));
  await assert.rejects(client.recover(), { code: 'INVALID_ANSWER' }); assert.equal(client.session.pending, undefined);
});
test('Retry-After prevents network retries until the server deadline', async (t) => {
  t.mock.method(storage, 'get', () => session()); let now = 1000; let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ ok: false, error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '10' } }); });
  const client = new RoomClient({ clock: () => now }); await assert.rejects(client.status(), { status: 429 });
  await assert.rejects(client.status(), { retryAfter: 10 }); assert.equal(calls, 1);
  now += 10000; await assert.rejects(client.status(), { status: 429 }); assert.equal(calls, 2);
});
test('malformed saved sessions are discarded without crashing recovery', async (t) => {
  t.mock.method(storage, 'get', () => ({ pending: {} })); const remove = t.mock.method(storage, 'remove', () => {});
  const client = new RoomClient(); assert.equal(client.session, null); assert.equal(remove.mock.calls.length, 1);
  await assert.rejects(client.recover(), { code: 'INVALID_SESSION' });
});
test('a write denied by quota stays usable even when storage reads succeed', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } }, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage; });
  storage.set('quota-test', { progress: 3 }); assert.deepEqual(storage.get('quota-test'), { progress: 3 });
  storage.remove('quota-test'); assert.equal(storage.get('quota-test'), null);
});
