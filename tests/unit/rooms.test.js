import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { MemoryStorage } from '../../server/storage/memory.js';
import { RoomService } from '../../server/domain/service.js';
import { standings, normalizeName } from '../../server/domain/room.js';
import { createStorage } from '../../server/storage/index.js';
const token = () => randomBytes(32).toString('base64url');
const requestId = () => randomUUID();
async function fixture({ participates = false, rounds = 2, difficulty = 'easy' } = {}) {
  let now = 100000;
  const storage = new MemoryStorage({ clock: () => now });
  const service = new RoomService(storage, { namespace: 'caesar-race:test', clock: () => now });
  const second = new RoomService(storage, { namespace: 'caesar-race:test', clock: () => now });
  const host = token();
  let view = (await service.execute('create', { name: 'Teacher', difficulty, rounds, participates, requestId: requestId() }, host)).room;
  const api = async (action, tok = host, extra = {}, handler = service) => handler.execute(action, { code: view.code, raceId: view.raceId, requestId: requestId(), ...extra }, tok);
  const add = async (name = 'Alice') => { const tok = token(); await service.execute('join', { code: view.code, name, requestId: requestId() }, tok); return tok; };
  const raw = () => storage.get(service.key(`room:${view.code}`));
  const start = async () => { view = (await api('start')).room; now += 3000; };
  return { service, second, storage, host, api, add, raw, start, get view() { return view; }, setNow: (value) => { now = value; }, now: () => now };
}
test('creation recovery is idempotent and stores hashes only', async () => {
  const storage = new MemoryStorage(); const service = new RoomService(storage); const host = token();
  const body = { name: 'Host', difficulty: 'easy', rounds: 3, participates: true, requestId: requestId() };
  const a = await service.execute('create', body, host); const b = await service.execute('create', body, host);
  assert.equal(a.room.code, b.room.code); assert.match(a.room.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  assert.equal(a.room.me.completed, 0); assert.ok(!JSON.stringify([...storage.values]).includes(host));
  await assert.rejects(service.execute('create', { ...body, rounds: 2 }, host), { code: 'REQUEST_CONFLICT' });
});
test('names normalize, duplicates reserve the host name, joins recover safely', async () => {
  const f = await fixture(); const player = token(); const body = { code: f.view.code, name: ' Alice ', requestId: requestId() };
  await f.service.execute('join', body, player); await f.service.execute('join', body, player);
  assert.equal((await f.raw()).members.length, 2);
  await assert.rejects(f.add('aLiCe'), { code: 'NAME_TAKEN' }); await assert.rejects(f.add('teacher'), { code: 'NAME_TAKEN' });
  assert.equal(normalizeName(' Alice   Smith '), 'Alice Smith');
  for (const name of ['', 'x'.repeat(25), 'a\u0000', 12, 'a\u200b']) assert.throws(() => normalizeName(name));
});
test('host participation consumes a slot; spectator does not; concurrent capacity is exact', async () => {
  for (const participates of [true, false]) {
    const f = await fixture({ participates });
    const results = await Promise.allSettled(Array.from({ length: 35 }, (_, i) => f.add(`Player ${i}`)));
    // Retry contention failures, without permitting capacity overflow.
    for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected' && results[i].reason.code === 'ROOM_CONFLICT') await f.add(`Retry ${i}`).catch((e) => assert.equal(e.code, 'ROOM_FULL'));
    assert.equal((await f.raw()).members.filter((m) => m.participates).length, 30);
    await assert.rejects(f.add('Overflow'), { code: 'ROOM_FULL' });
  }
});
test('authorization, countdown boundary and late join rejection', async () => {
  const f = await fixture(); const p = await f.add();
  for (const action of ['start', 'cancel', 'reset']) await assert.rejects(f.api(action, p), { code: 'HOST_ONLY' });
  await assert.rejects(f.api('status', token()), { code: 'INVALID_SESSION' });
  await f.api('start');
  assert.equal((await f.api('status', p)).room.me.challenge, undefined);
  await assert.rejects(f.add('Late'), { code: 'ROOM_NOT_IN_LOBBY' });
  await assert.rejects(f.api('answer', p, { roundIndex: 0, answer: 'hello' }), { code: 'RACE_NOT_ACTIVE' });
  f.setNow(f.now() + 3000);
  assert.ok((await f.api('status', p)).room.me.challenge);
});
test('independent progress, hint and answer receipts, safe Next retry', async () => {
  const f = await fixture(); const p = await f.add(); const q = await f.add('Bob'); await f.start();
  const hintId = requestId();
  await f.api('hint', p, { requestId: hintId, roundIndex: 0, hintNumber: 1 });
  await f.api('hint', p, { requestId: hintId, roundIndex: 0, hintNumber: 1 });
  const badId = requestId();
  await f.api('answer', p, { requestId: badId, roundIndex: 0, answer: 'wrong' });
  await f.api('answer', p, { requestId: badId, roundIndex: 0, answer: 'wrong' });
  await assert.rejects(f.api('answer', p, { requestId: badId, roundIndex: 0, answer: 'changed' }), { code: 'REQUEST_CONFLICT' });
  const c = (await f.raw()).sequence[0]; const correctId = requestId();
  await f.api('answer', p, { requestId: correctId, roundIndex: 0, answer: c.plaintext });
  await f.api('answer', p, { requestId: correctId, roundIndex: 0, answer: c.plaintext });
  const personal = (await f.api('status', p)).room.me;
  assert.equal(personal.completed, 1); assert.equal(personal.attempts, 2); assert.equal(personal.hints, 1); assert.equal(personal.points, 88); assert.equal(personal.roundIndex, 0);
  assert.equal((await f.api('status', q)).room.me.completed, 0);
  const nextId = requestId(); await f.api('next', p, { requestId: nextId, roundIndex: 0 }); await f.api('next', p, { requestId: nextId, roundIndex: 0 });
  assert.equal((await f.api('status', p)).room.me.roundIndex, 1);
});
test('two handlers racing final submissions produce exactly one winner', async () => {
  const f = await fixture({ rounds: 1 }); const p = await f.add(); const q = await f.add('Bob'); await f.start();
  const answer = (await f.raw()).sequence[0].plaintext;
  const results = await Promise.allSettled([f.api('answer', p, { roundIndex: 0, answer }), f.api('answer', q, { roundIndex: 0, answer }, f.second)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const raw = await f.raw(); assert.equal(raw.status, 'finished'); assert.equal(raw.members.filter((m) => m.progress.completed === 1).length, 1); assert.ok(raw.winnerId);
  await assert.rejects(f.api('hint', q, { roundIndex: 0, hintNumber: 1 }), { code: 'RACE_FINISHED' });
});
test('projections hide private bindings, future challenges and unrevealed keys', async () => {
  const f = await fixture(); const p = await f.add(); const q = await f.add('Bob'); await f.start();
  const raw = await f.raw(); const preview = await f.service.execute('preview', { code: f.view.code }, '');
  assert.equal(preview.room.members, undefined); assert.equal(preview.room.me, undefined);
  for (const tok of [f.host, p, q]) {
    const data = await f.api('status', tok); const json = JSON.stringify(data);
    for (const key of ['hash', 'sequence', 'joinReceipts', 'plaintext', 'key', 'bankVersion']) assert.ok(!json.includes(`"${key}":`), key);
    assert.ok(!json.includes(raw.sequence[1].ciphertext)); assert.ok(!json.includes(raw.sequence[0].plaintext));
  }
  assert.equal((await f.api('status', p)).room.me.challenge.ciphertext, (await f.api('status', q)).room.me.challenge.ciphertext);
});
test('departure releases lobby names and invalidates membership; all leaving cancels', async () => {
  const f = await fixture(); const p = await f.add(); const leave = requestId(); await f.api('leave', p, { requestId: leave }); await f.api('leave', p, { requestId: leave });
  await assert.rejects(f.api('status', p), { code: 'INVALID_SESSION' });
  const q = await f.add('Alice'); await f.start(); await f.api('leave', q);
  const raw = await f.raw(); assert.equal(raw.status, 'cancelled'); assert.equal(raw.members.find((m) => m.name === 'Alice').left, true);
});
test('rematches retain membership, change race identity and reject stale requests', async () => {
  const f = await fixture(); const p = await f.add(); await f.start(); const original = await f.raw();
  await f.api('cancel'); const reset = await f.api('reset');
  assert.equal(reset.room.status, 'lobby'); assert.notEqual(reset.room.raceId, original.raceId); assert.equal(reset.room.occupancy, 1);
  assert.notDeepEqual((await f.raw()).sequence, original.sequence);
  assert.equal((await f.api('status', p)).room.me.completed, 0);
  await assert.rejects(f.api('answer', p, { roundIndex: 0, answer: original.sequence[0].plaintext }), { code: 'STALE_RACE' });
  assert.equal((await f.raw()).expiresAt, original.expiresAt);
});
test('host close is permanent and expiry never slides or resurrects rooms', async () => {
  const f = await fixture(); await f.add(); const original = await f.raw(); await f.api('leave');
  assert.equal((await f.raw()).status, 'closed');
  f.setNow(original.expiresAt); await assert.rejects(f.api('status'), { code: 'ROOM_UNAVAILABLE' });
});
test('standings prioritize winner, rounds, points, earlier latest solve, join order', () => {
  const member = (id, completed, points, latestCorrectAt, joinOrder) => ({ id, participates: true, joinOrder, progress: { completed, points, latestCorrectAt } });
  const room = { winnerId: 'winner', members: [member('later', 2, 100, 20, 1), member('earlier', 2, 100, 10, 2), member('points', 2, 200, 30, 3), member('rounds', 3, 20, 40, 4), member('winner', 1, 20, 50, 5)] };
  assert.deepEqual(standings(room).map((m) => m.id), ['winner', 'rounds', 'points', 'earlier', 'later']);
});
test('production cannot silently fall back to memory', () => {
  assert.throws(() => createStorage({ VERCEL: '1', CAESAR_STORAGE: 'memory' }), { code: 'STORAGE_UNAVAILABLE' });
  assert.throws(() => createStorage({ NODE_ENV: 'production' }), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(createStorage({}).kind, 'memory');
});
test('a final answer racing cancellation has one coherent terminal outcome', async () => {
  for (let i = 0; i < 5; i++) {
    const f = await fixture({ rounds: 1, participates: true }); await f.start();
    const answer = (await f.raw()).sequence[0].plaintext;
    await Promise.allSettled([f.api('answer', f.host, { roundIndex: 0, answer }), f.api('cancel', f.host, {}, f.second)]);
    const raw = await f.raw();
    assert.ok(['finished', 'cancelled'].includes(raw.status));
    assert.equal(Boolean(raw.winnerId), raw.status === 'finished');
    assert.equal(raw.members[0].progress.completed, raw.status === 'finished' ? 1 : 0);
  }
});
test('late answers and repeated resets cannot alter the newly prepared race', async () => {
  const f = await fixture({ participates: true }); await f.start(); await f.api('cancel');
  await Promise.allSettled([f.api('reset'), f.api('reset', f.host, {}, f.second), f.api('answer', f.host, { roundIndex: 0, answer: 'late answer' }, f.second)]);
  const raw = await f.raw(); assert.equal(raw.status, 'lobby'); assert.notEqual(raw.raceId, f.view.raceId); assert.equal(raw.members[0].progress.attempts, 0);
});
test('revoked sessions cannot replay old gameplay receipts, but leave retries remain safe', async () => {
  const f = await fixture(); const player = await f.add(); await f.start();
  const hintId = requestId(); const leaveId = requestId();
  await f.api('hint', player, { requestId: hintId, roundIndex: 0, hintNumber: 1 });
  await f.api('leave', player, { requestId: leaveId });
  await assert.rejects(f.api('hint', player, { requestId: hintId, roundIndex: 0, hintNumber: 1 }), { code: 'INVALID_SESSION' });
  assert.equal((await f.api('leave', player, { requestId: leaveId })).outcome.left, true);
});
test('production validates its namespace, TLS and rate-limit secret', () => {
  const env = { VERCEL: '1', CAESAR_REDIS_REST_URL: 'https://example.upstash.io', CAESAR_REDIS_REST_TOKEN: 'test', CAESAR_REDIS_NAMESPACE: 'caesar-race:prod:v1', CAESAR_RATE_LIMIT_SECRET: 's'.repeat(32) };
  for (const change of [{ CAESAR_REDIS_NAMESPACE: 'room:v8' }, { CAESAR_REDIS_REST_URL: 'http://example.upstash.io' }, { CAESAR_RATE_LIMIT_SECRET: 'short' }, { CAESAR_REDIS_REST_URL: 'https://name:secret@example.upstash.io' }]) assert.throws(() => createStorage({ ...env, ...change }), { code: 'STORAGE_UNAVAILABLE' });
});
