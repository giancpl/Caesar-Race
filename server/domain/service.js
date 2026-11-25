import { setTimeout as delay } from 'node:timers/promises';
import { makeRoom, assertRoom, authenticate, normalizeCode, normalizeName, tokenHash, fingerprint, join, transition, project } from './room.js';
import { RuleError } from '../../src/core/rules.js';
export class RoomService {
  constructor(storage, { namespace = 'caesar-race:dev:v1', clock = Date.now } = {}) { this.storage = storage; this.namespace = namespace; this.clock = clock; }
  key(suffix) { return `${this.namespace}:${suffix}`; }
  async load(code) { const room = await this.storage.get(this.key(`room:${code}`)); assertRoom(room, this.clock()); return room; }
  async view(room, member) {
    let presence = {};
    if (member && !member.left) presence = await this.storage.presence(this.key(`presence:${room.code}`), member.id, this.clock(), room.expiresAt);
    return project(room, member?.left ? null : member, this.clock(), presence);
  }
  async execute(action, body, token) {
    if (action === 'preview') return { room: project(await this.load(normalizeCode(body.code)), null, this.clock()) };
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new RuleError('INVALID_SESSION', 401);
    const hash = tokenHash(token);
    if (action === 'create') {
      const normalized = { name: normalizeName(body.name), difficulty: body.difficulty, rounds: body.rounds, participates: body.participates, requestId: body.requestId };
      const fp = fingerprint(normalized);
      const bootstrapKey = this.key(`bootstrap:${hash}`);
      for (let i = 0; i < 8; i++) {
        const room = makeRoom(normalized, hash, this.clock());
        const result = await this.storage.create(this.key(`room:${room.code}`), room, bootstrapKey, fp);
        if (result.existing) {
          if (result.existing.fingerprint !== fp) throw new RuleError('REQUEST_CONFLICT');
          const existing = await this.load(result.existing.code);
          return { room: await this.view(existing, authenticate(existing, hash)), recovered: true };
        }
        if (result.created) return { room: await this.view(room, room.members[0]) };
      }
      throw new RuleError('ROOM_CODE_UNAVAILABLE', 503);
    }
    const code = normalizeCode(body.code);
    if (action === 'status') { const room = await this.load(code); return { room: await this.view(room, authenticate(room, hash)) }; }
    const roomKey = this.key(`room:${code}`);
    const normalized = { ...body, code, ...(action === 'join' ? { name: normalizeName(body.name) } : {}) };
    const fp = fingerprint([action, Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)))]);
    for (let attempt = 0; attempt < 8; attempt++) {
      const room = await this.load(code);
      if (action !== 'join' && room.raceId !== body.raceId) throw new RuleError('STALE_RACE');
      const receiptKey = this.key(action === 'join' ? `join:${code}:${hash}` : `receipt:${code}:${body.raceId}:${hash}:${body.requestId}`);
      const receipt = await this.storage.get(receiptKey);
      if (receipt) {
        if (action !== 'leave') authenticate(room, hash);
        if (receipt.fingerprint !== fp) throw new RuleError('REQUEST_CONFLICT');
        const member = room.members.find((m) => m.hash === hash);
        if (action === 'join' && (!member || member.left)) throw new RuleError('INVALID_SESSION', 401);
        return { room: await this.view(room, member), outcome: receipt.outcome, duplicate: true };
      }
      const expected = room.version;
      let member;
      let outcome;
      if (action === 'join') {
        if (room.members.some((m) => m.hash === hash)) throw new RuleError('REQUEST_CONFLICT');
        member = join(room, normalized, hash); outcome = { joined: true };
      } else {
        member = authenticate(room, hash);
        outcome = transition(room, member, action, body, this.clock());
      }
      room.version++;
      const result = await this.storage.commit(roomKey, expected, room, receiptKey, { fingerprint: fp, outcome });
      if (result.committed) return { room: await this.view(room, member), outcome };
      if (result.receipt && result.receipt.fingerprint !== fp) throw new RuleError('REQUEST_CONFLICT');
      await delay(Math.min(80, 5 * (attempt + 1)));
    }
    throw new RuleError('ROOM_CONFLICT');
  }
}
