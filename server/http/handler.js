import { createHmac } from 'node:crypto';
import { createStorage } from '../storage/index.js';
import { RoomService } from '../domain/service.js';
import { RuleError } from '../../src/core/rules.js';
const reads = new Set(['preview', 'status']);
const actions = new Set(['create', 'preview', 'join', 'status', 'start', 'answer', 'hint', 'next', 'leave', 'cancel', 'reset']);
const fields = {
  create: ['requestId', 'name', 'difficulty', 'rounds', 'participates'], join: ['requestId', 'code', 'name'],
  start: ['requestId', 'code', 'raceId'], cancel: ['requestId', 'code', 'raceId'], reset: ['requestId', 'code', 'raceId'], leave: ['requestId', 'code', 'raceId'],
  answer: ['requestId', 'code', 'raceId', 'roundIndex', 'answer'], hint: ['requestId', 'code', 'raceId', 'roundIndex', 'hintNumber'], next: ['requestId', 'code', 'raceId', 'roundIndex']
};
const limits = { create: [20, 3600000], join: [120, 60000], preview: [120, 60000], status: [60, 60000], answer: [60, 60000] };
export function createHandler({ storage, env = process.env, clock = Date.now } = {}) {
  let service;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://local');
      if (!['/api/health', '/api/room'].includes(url.pathname)) return send(404, { ok: false, error: 'NOT_FOUND' });
      if (!service) service = new RoomService(storage || createStorage(env), { namespace: env.CAESAR_REDIS_NAMESPACE || 'caesar-race:dev:v1', clock });
      if (url.pathname === '/api/health') {
        if (req.method !== 'GET') throw new RuleError('METHOD_NOT_ALLOWED', 405);
        if (!await service.storage.ping()) throw new RuleError('STORAGE_UNAVAILABLE', 503);
        return send(200, { ok: true, storage: service.storage.kind });
      }
      const action = url.searchParams.get('action');
      if (!actions.has(action)) throw new RuleError('INVALID_ACTION', 400);
      if (req.method !== (reads.has(action) ? 'GET' : 'POST')) { res.setHeader('Allow', reads.has(action) ? 'GET' : 'POST'); throw new RuleError('METHOD_NOT_ALLOWED', 405); }
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1] || '';
      const ip = env.VERCEL ? (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown') : req.socket?.remoteAddress || 'local';
      const subject = ['create', 'join', 'preview'].includes(action) ? String(ip) : token || String(ip);
      const identity = createHmac('sha256', env.CAESAR_RATE_LIMIT_SECRET || 'local-development-only').update(subject).digest('hex');
      const [max, window] = limits[action] || [30, 60000];
      const rate = await service.storage.limit(service.key(`limit:${action}:${identity}`), max, window);
      if (!rate.allowed) { res.setHeader('Retry-After', String(rate.retryAfter)); throw new RuleError('RATE_LIMITED', 429); }
      if (action === 'answer') {
        const burst = await service.storage.limit(service.key(`burst:${identity}`), 10, 1000);
        if (!burst.allowed) { res.setHeader('Retry-After', String(burst.retryAfter)); throw new RuleError('RATE_LIMITED', 429); }
      }
      let body;
      if (reads.has(action)) body = { code: url.searchParams.get('code') };
      else {
        const origin = req.headers.origin;
        if (origin) {
          let originHost;
          try { originHost = new URL(origin).host; } catch { throw new RuleError('INVALID_ORIGIN', 403); }
          if (originHost !== req.headers.host) throw new RuleError('INVALID_ORIGIN', 403);
        }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new RuleError('INVALID_CONTENT_TYPE', 415);
        if (Number(req.headers['content-length']) > 4096) throw new RuleError('BODY_TOO_LARGE', 413);
        if (req.body !== undefined) {
          const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body);
          if (Buffer.byteLength(raw) > 4096) throw new RuleError('BODY_TOO_LARGE', 413);
          body = JSON.parse(raw);
        } else {
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new RuleError('BODY_TOO_LARGE', 413); chunks.push(chunk); }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !fields[action].includes(key)) || fields[action].some((key) => !(key in body))) throw new RuleError('INVALID_BODY', 400);
        if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(body.requestId)) throw new RuleError('INVALID_REQUEST_ID', 400);
        if (action !== 'create' && action !== 'join' && (typeof body.raceId !== 'string' || !/^[a-f0-9]{32}$/.test(body.raceId))) throw new RuleError('INVALID_RACE_ID', 400);
        if (['answer', 'hint', 'next'].includes(action) && (!Number.isInteger(body.roundIndex) || body.roundIndex < 0 || body.roundIndex > 9)) throw new RuleError('INVALID_ROUND', 400);
      }
      const result = await service.execute(action, body, token);
      return send(200, { ok: true, ...result });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof URIError) return send(400, { ok: false, error: 'INVALID_BODY' });
      if (error instanceof RuleError || error.code === 'STORAGE_UNAVAILABLE') return send(error.status || 503, { ok: false, error: error.code });
      // Deliberately omit request bodies, tokens and provider error messages.
      console.error('Room request failed', { type: error.name });
      return send(503, { ok: false, error: 'STORAGE_UNAVAILABLE' });
    }
  };
}
