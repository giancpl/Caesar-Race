import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomId, secureBytes } from '../../src/core/random.js';
import { RoomClient } from '../../src/transport/api.js';
import { storage } from '../../src/transport/session.js';
import { createSolo } from '../../src/solo/game.js';

function cryptoOnly(t, crypto) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  t.after(() => Object.defineProperty(globalThis, 'crypto', previous));
}
test('UUIDs, solo and bootstrap work with secure randomness but no randomUUID', async (t) => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  cryptoOnly(t, { getRandomValues });
  t.mock.method(storage, 'get', () => null); t.mock.method(storage, 'set', () => {});
  let authorization; let requestId;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    authorization = options.headers.Authorization; requestId = JSON.parse(options.body).requestId;
    return Response.json({ ok: true, room: { code: 'ABC234', expiresAt: Date.now() + 10000, serverNow: Date.now() } });
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ids = Array.from({ length: 20 }, () => randomId());
  ids.forEach((id) => assert.match(id, uuid)); assert.equal(new Set(ids).size, ids.length);
  assert.match(createSolo('easy', 1).id, uuid);
  await new RoomClient().bootstrap('create', { name: 'BitPolito', difficulty: 'easy', rounds: 1, participates: false });
  assert.match(requestId, uuid); assert.match(authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
});
test('UUID encoding sets its version/variant and missing secure randomness fails closed', (t) => {
  cryptoOnly(t, { getRandomValues: (bytes) => bytes.fill(255) });
  assert.equal(randomId(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  globalThis.crypto.getRandomValues = undefined;
  assert.throws(() => randomId(), { code: 'SECURE_CONTEXT_REQUIRED' });
  assert.throws(() => secureBytes(32), { code: 'SECURE_CONTEXT_REQUIRED' });
});
