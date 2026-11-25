import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { RedisStorage } from '../server/storage/redis.js';
import { RoomService } from '../server/domain/service.js';
import { storageContract } from './storage-contract.js';
import { createHandler } from '../server/http/handler.js';
const url = process.env.CAESAR_TEST_REDIS_REST_URL;
const token = process.env.CAESAR_TEST_REDIS_REST_TOKEN;
if (process.env.CAESAR_REQUIRE_REDIS_TESTS === '1' && (!url || !token)) throw new Error('Required integration-test credentials are missing');
test('isolated Redis HTTP adapter: contracts, expiry, idempotency and competing final submissions', { skip: !url || !token ? 'UNVERIFIED: dedicated test Redis credentials are missing' : false }, async () => {
  assert.notEqual(url, process.env.CAESAR_REDIS_REST_URL, 'Test database must differ from configured application database');
  const prefix = `caesar-race:test:${randomUUID()}`; const keys = new Set();
  const adapter = new RedisStorage({ url, token });
  const storage = new Proxy(adapter, { get(target, property) {
    const fn = target[property]; if (typeof fn !== 'function') return fn;
    return (...args) => {
      for (const arg of args) if (typeof arg === 'string' && arg.startsWith(prefix)) keys.add(arg);
      if (property === 'create') args[1] = { ...args[1], expiresAt: Math.min(args[1].expiresAt, Date.now() + 120000) };
      return fn.apply(target, args);
    };
  } });
  try {
    await storageContract(storage, `${prefix}:contract`, Date.now());
    let now = Date.now();
    const a = new RoomService(storage, { namespace: prefix, clock: () => now }); const b = new RoomService(storage, { namespace: prefix, clock: () => now });
    const host = randomBytes(32).toString('base64url'); const player = randomBytes(32).toString('base64url'); const other = randomBytes(32).toString('base64url');
    const created = await a.execute('create', { requestId: randomUUID(), name: 'Host', difficulty: 'easy', rounds: 1, participates: false }, host);
    const common = { code: created.room.code, raceId: created.room.raceId };
    await b.execute('join', { code: common.code, requestId: randomUUID(), name: 'Player' }, player);
    await b.execute('join', { code: common.code, requestId: randomUUID(), name: 'Other' }, other);
    await a.execute('start', { ...common, requestId: randomUUID() }, host); now += 3000;
    const hintBody = { ...common, requestId: randomUUID(), roundIndex: 0, hintNumber: 1 };
    await a.execute('hint', hintBody, player); await b.execute('hint', hintBody, player);
    assert.equal((await a.execute('status', { code: common.code }, player)).room.me.hints, 1);
    const raw = await storage.get(`${prefix}:room:${common.code}`); const answer = raw.sequence[0].plaintext;
    const outcomes = await Promise.allSettled([a.execute('answer', { ...common, requestId: randomUUID(), roundIndex: 0, answer }, player), b.execute('answer', { ...common, requestId: randomUUID(), roundIndex: 0, answer }, other)]);
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    const finished = await storage.get(`${prefix}:room:${common.code}`); assert.equal(finished.status, 'finished'); assert.equal(finished.members.filter((m) => m.progress.completed).length, 1);
    // Independent HTTP handlers share only Redis, as separate function instances do.
    const env = { CAESAR_REDIS_NAMESPACE: prefix, CAESAR_RATE_LIMIT_SECRET: 'isolated-integration-secret' };
    const handlers = [createHandler({ storage, env, clock: () => now }), createHandler({ storage, env, clock: () => now })];
    async function call(index, action, body, bearer = host) {
      const req = { url: `/api/room?action=${action}`, method: 'POST', body, headers: { host: 'localhost', 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, socket: { remoteAddress: 'integration' } };
      const res = { setHeader() {}, end(value) { this.data = JSON.parse(value); } };
      await handlers[index](req, res);
      if (!res.data.ok) throw Object.assign(new Error(res.data.error), { code: res.data.error });
      return res.data;
    }
    async function freshRace() {
      const created = await call(0, 'create', { requestId: randomUUID(), name: 'Host', difficulty: 'easy', rounds: 1, participates: false }, randomBytes(32).toString('base64url'));
      return { code: created.room.code, raceId: created.room.raceId };
    }
    // Concurrent names and the last capacity slot must be checked in the commit.
    const lobby = await freshRace();
    const names = await Promise.allSettled(handlers.map((_, index) => call(index, 'join', { code: lobby.code, name: 'Same name', requestId: randomUUID() }, randomBytes(32).toString('base64url'))));
    assert.equal(names.filter((result) => result.status === 'fulfilled').length, 1);
    for (let index = 0; index < 28; index++) await call(index % 2, 'join', { code: lobby.code, name: `Player ${index}`, requestId: randomUUID() }, randomBytes(32).toString('base64url'));
    const lastSlot = await Promise.allSettled(handlers.map((_, index) => call(index, 'join', { code: lobby.code, name: `Last ${index}`, requestId: randomUUID() }, randomBytes(32).toString('base64url'))));
    assert.equal(lastSlot.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await storage.get(`${prefix}:room:${lobby.code}`)).members.length, 31);
    for (let iteration = 0; iteration < 3; iteration++) {
      const bearer = randomBytes(32).toString('base64url');
      const created = await call(0, 'create', { requestId: randomUUID(), name: 'Host', difficulty: 'easy', rounds: 1, participates: false }, bearer);
      const race = { code: created.room.code, raceId: created.room.raceId };
      const racer = randomBytes(32).toString('base64url');
      await call(1, 'join', { code: race.code, requestId: randomUUID(), name: 'Racer' }, racer);
      await call(0, 'start', { ...race, requestId: randomUUID() }, bearer); now += 3000;
      const solution = (await storage.get(`${prefix}:room:${race.code}`)).sequence[0].plaintext;
      await Promise.allSettled([call(0, 'answer', { ...race, requestId: randomUUID(), roundIndex: 0, answer: solution }, racer), call(1, 'cancel', { ...race, requestId: randomUUID() }, bearer)]);
      const terminal = await storage.get(`${prefix}:room:${race.code}`);
      assert.ok(['finished', 'cancelled'].includes(terminal.status));
      assert.equal(Boolean(terminal.winnerId), terminal.status === 'finished');
      assert.equal(terminal.members[1].progress.completed, terminal.status === 'finished' ? 1 : 0);
      const resetResults = await Promise.allSettled([call(0, 'reset', { ...race, requestId: randomUUID() }, bearer), call(1, 'reset', { ...race, requestId: randomUUID() }, bearer), call(1, 'answer', { ...race, requestId: randomUUID(), roundIndex: 0, answer: solution }, racer)]);
      assert.equal(resetResults.filter((result) => result.status === 'fulfilled').length, 1);
      const rematch = await storage.get(`${prefix}:room:${race.code}`);
      assert.equal(rematch.status, 'lobby'); assert.notEqual(rematch.raceId, race.raceId);
      assert.equal(rematch.winnerId, null); assert.equal(rematch.members[1].progress.attempts, 0);
      assert.equal(rematch.expiresAt, terminal.expiresAt);
    }
    const shortKey = `${prefix}:expires`; await adapter.client.set(shortKey, JSON.stringify({ version: 1 }), { px: 50 }); keys.add(shortKey);
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(await storage.get(shortKey), null);
  } finally {
    assert.ok([...keys].every((key) => key.startsWith(`${prefix}:`)));
    if (keys.size) await adapter.client.del(...keys);
  }
});
