import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { createHandler } from '../../server/http/handler.js';
import { MemoryStorage } from '../../server/storage/memory.js';
const token = () => randomBytes(32).toString('base64url');
function client(handler) {
  return async (action, { method = 'POST', body = {}, bearer = token(), headers = {}, raw, chunks } = {}) => {
    const req = Readable.from(chunks || []);
    Object.assign(req, { url: `/api/room?action=${action}`, method, headers: { host: 'localhost', 'content-type': 'application/json', authorization: `Bearer ${bearer}`, ...headers }, socket: { remoteAddress: '127.0.0.1' }, ...(chunks ? {} : { body: raw ?? body }) });
    if (method === 'GET') req.url += `&code=${body.code || ''}`;
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.data = JSON.parse(value); } };
    await handler(req, response); return { status: response.statusCode, ...response.data, headers: response.headers };
  };
}
const createBody = () => ({ name: 'Host', difficulty: 'easy', rounds: 1, participates: true, requestId: randomUUID() });
test('HTTP validates methods, JSON, strict shape, actual body size and origin', async () => {
  const call = client(createHandler({ storage: new MemoryStorage(), env: {} }));
  assert.equal((await call('create', { method: 'GET' })).status, 405);
  assert.equal((await call('unknown')).status, 400);
  assert.equal((await call('create', { raw: '{' })).status, 400);
  assert.equal((await call('create', { body: [] })).status, 400);
  assert.equal((await call('create', { body: { ...createBody(), extra: true } })).status, 400);
  assert.equal((await call('create', { body: createBody(), headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call('create', { body: createBody(), headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('create', { body: createBody(), headers: { origin: 'not a URL' } })).status, 403);
  assert.equal((await call('create', { raw: 'x'.repeat(5000) })).status, 413);
  const streamCall = client(createHandler({ storage: new MemoryStorage(), env: {} }));
  assert.equal((await streamCall('create', { chunks: [Buffer.alloc(3000), Buffer.alloc(3000)] })).status, 413);
});
test('HTTP applies distributed rate limits without altering gameplay', async () => {
  const storage = new MemoryStorage(); const call = client(createHandler({ storage, env: {} }));
  const host = token(); const created = await call('create', { bearer: host, body: createBody() }); assert.equal(created.status, 200);
  const common = { code: created.room.code, raceId: created.room.raceId, requestId: randomUUID() };
  let rate;
  for (let i = 0; i < 11; i++) rate = await call('answer', { bearer: host, body: { ...common, requestId: randomUUID(), roundIndex: 0, answer: 'hello' } });
  assert.equal(rate.status, 429); assert.ok(rate.headers['Retry-After']);
  const status = await call('status', { method: 'GET', bearer: host, body: { code: created.room.code } }); assert.equal(status.room.me.attempts, 0);
});
test('HTTP reports storage outages and production misconfiguration explicitly', async () => {
  const call = client(createHandler({ env: { VERCEL: '1' } }));
  assert.equal((await call('create', { body: createBody() })).error, 'STORAGE_UNAVAILABLE');
  const failing = client(createHandler({ storage: { limit() { throw new Error('private provider details'); } }, env: {} }));
  const response = await failing('create', { body: createBody() }); assert.equal(response.status, 503); assert.ok(!JSON.stringify(response).includes('private provider'));
});
test('safe text projection never interprets names as HTML', async () => {
  const call = client(createHandler({ storage: new MemoryStorage(), env: {} })); const host = token();
  const created = await call('create', { bearer: host, body: { ...createBody(), name: '<img src=x>' } }); assert.equal(created.room.me.name, '<img src=x>');
  assert.equal(created.headers['Cache-Control'], 'no-store'); assert.equal(created.headers['X-Content-Type-Options'], 'nosniff');
});
