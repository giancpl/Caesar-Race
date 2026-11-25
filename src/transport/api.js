import { storage, ROOM_SESSION } from './session.js';
export function newRequestId() {
  if (!globalThis.crypto?.randomUUID) throw new ApiError('SECURE_CONTEXT_REQUIRED');
  return crypto.randomUUID();
}
function newToken() {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.randomUUID) throw new ApiError('SECURE_CONTEXT_REQUIRED');
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export class ApiError extends Error {
  constructor(code, status = 0, retryAfter = 0) { super(code); this.code = code; this.status = status; this.retryAfter = retryAfter; }
}
export class RoomClient {
  constructor({ clock = Date.now } = {}) {
    const saved = storage.get(ROOM_SESSION);
    const valid = saved && typeof saved === 'object' && /^[A-Za-z0-9_-]{43}$/.test(saved.token) &&
      (typeof saved.code === 'string' || saved.bootstrap && ['create', 'join'].includes(saved.bootstrap.action) && saved.bootstrap.body?.requestId) &&
      (!saved.pending || typeof saved.pending.action === 'string' && typeof saved.pending.body === 'object' && saved.pending.body?.requestId);
    this.session = valid ? saved : null;
    if (saved && !valid) storage.remove(ROOM_SESSION);
    this.offset = 0; this.requests = new Set(); this.recovery = null; this.clock = clock; this.retryAt = new Map();
  }
  save() { storage.set(ROOM_SESSION, this.session); }
  clear() { this.dispose(); this.session = null; this.recovery = null; storage.remove(ROOM_SESSION); }
  assertCurrent(session) { if (this.session !== session) throw new ApiError('SESSION_CHANGED'); }
  async request(action, body, token = this.session?.token) {
    const remaining = (this.retryAt.get(action) || 0) - this.clock();
    if (remaining > 0) throw new ApiError('RATE_LIMITED', 429, Math.ceil(remaining / 1000));
    const controller = new AbortController(); this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    const read = ['preview', 'status'].includes(action);
    const start = Date.now();
    try {
      const response = await fetch(`/api/room?action=${action}${read ? `&code=${encodeURIComponent(body.code)}` : ''}`, { method: read ? 'GET' : 'POST', cache: 'no-store', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!read ? { 'Content-Type': 'application/json' } : {}) }, ...(!read ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      const data = await response.json().catch(() => { throw new ApiError('INVALID_RESPONSE'); });
      if (!response.ok || !data.ok) {
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        if (response.status === 429 && Number.isFinite(retryAfter)) this.retryAt.set(action, this.clock() + Math.max(1, retryAfter) * 1000);
        throw new ApiError(data.error || 'REQUEST_FAILED', response.status, retryAfter);
      }
      if (data.room) this.offset = data.room.serverNow - (start + Date.now()) / 2;
      return data;
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('NETWORK_ERROR'); }
    finally { clearTimeout(timer); this.requests.delete(controller); }
  }
  async bootstrap(action, body) {
    if (this.session?.bootstrap || this.session?.pending) throw new ApiError('PENDING_REQUEST');
    this.dispose();
    this.session = { token: newToken(), code: body.code || null, bootstrap: { action, body: { ...body, requestId: newRequestId() } } }; this.save();
    return this.recover();
  }
  recover() {
    const session = this.session;
    if (!session) return Promise.reject(new ApiError('INVALID_SESSION', 401));
    if (this.recovery?.session === session) return this.recovery.promise;
    const promise = this.recoverSession(session).finally(() => { if (this.recovery?.promise === promise) this.recovery = null; });
    this.recovery = { session, promise };
    return promise;
  }
  async recoverSession(session) {
    if (session.bootstrap) {
      const { action, body } = session.bootstrap;
      let data;
      try { data = await this.request(action, body, session.token); this.assertCurrent(session); }
      catch (error) { if (this.session === session && error.status >= 400 && error.status < 500 && error.status !== 429) this.clear(); throw error; }
      session.code = data.room.code; session.expiresAt = data.room.expiresAt; delete session.bootstrap; this.save();
      return data;
    }
    if (session.pending) {
      const pending = session.pending;
      try {
        const data = await this.request(pending.action, pending.body, session.token); this.assertCurrent(session);
        delete session.pending; this.save(); return data;
      } catch (error) {
        if (this.session === session && error.status >= 400 && error.status < 500 && error.status !== 429) { delete session.pending; this.save(); }
        throw error;
      }
    }
    return this.status();
  }
  async status() {
    const session = this.session;
    if (!session) throw new ApiError('INVALID_SESSION', 401);
    const data = await this.request('status', { code: session.code }, session.token); this.assertCurrent(session); return data;
  }
  async mutate(action, room, extra = {}) {
    if (!this.session) throw new ApiError('INVALID_SESSION', 401);
    const session = this.session;
    if (this.recovery) await this.recovery.promise;
    this.assertCurrent(session);
    if (this.session.pending) throw new ApiError('PENDING_REQUEST');
    this.session.pending = { action, body: { code: room.code, raceId: room.raceId, requestId: newRequestId(), ...extra } }; this.save();
    return this.retry();
  }
  retry() { return this.recover(); }
  dispose() { for (const request of this.requests) request.abort(); this.requests.clear(); }
}
