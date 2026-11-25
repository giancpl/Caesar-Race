import { randomBytes, randomInt, createHash } from 'node:crypto';
import { generateSequence, BANK_VERSION } from '../../src/challenges/generate.js';
import { RULES_VERSION, freshProgress, applyRound, hintText, RuleError } from '../../src/core/rules.js';
export const TTL = 86400000;
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export const fingerprint = (value) => tokenHash(JSON.stringify(value));
export function normalizeCode(code) {
  if (typeof code !== 'string') throw new RuleError('INVALID_ROOM_CODE', 400);
  const result = code.toUpperCase().replace(/\s/g, '');
  if (result.length !== 6 || [...result].some((c) => !alphabet.includes(c))) throw new RuleError('INVALID_ROOM_CODE', 400);
  return result;
}
export function normalizeName(name) {
  if (typeof name !== 'string' || /[\p{Cc}\p{Cf}]/u.test(name)) throw new RuleError('INVALID_NAME', 400);
  const normalized = name.trim().replace(/\s+/g, ' ');
  if ([...normalized].length < 1 || [...normalized].length > 24) throw new RuleError('INVALID_NAME', 400);
  return normalized;
}
const nameKey = (name) => name.toLocaleLowerCase('en');
export function newCode() { return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
export function newId() { return randomBytes(16).toString('hex'); }
export function settings(body) {
  if (!['easy', 'hard'].includes(body.difficulty) || !Number.isInteger(body.rounds) || body.rounds < 1 || body.rounds > 10 || typeof body.participates !== 'boolean') throw new RuleError('INVALID_SETTINGS', 400);
  return { difficulty: body.difficulty, rounds: body.rounds };
}
export function makeRoom(body, hash, now, code = newCode()) {
  const config = settings(body);
  const host = { id: newId(), name: normalizeName(body.name), hash, host: true, participates: body.participates, left: false, joinOrder: 0, progress: freshProgress() };
  return { schema: 1, rulesVersion: RULES_VERSION, bankVersion: BANK_VERSION, version: 1, code, raceId: newId(), ...config, createdAt: now, expiresAt: now + TTL, status: 'lobby', startsAt: null, endedAt: null, winnerId: null, members: [host], nextJoinOrder: 1, sequence: generateSequence(config.difficulty, config.rounds) };
}
export function assertRoom(room, now) {
  if (!room) throw new RuleError('ROOM_UNAVAILABLE', 404);
  if (room.expiresAt <= now) throw new RuleError('ROOM_EXPIRED', 410);
  if (room.schema !== 1 || room.rulesVersion !== RULES_VERSION || room.bankVersion !== BANK_VERSION) throw new RuleError('ROOM_VERSION_UNSUPPORTED');
}
export function authenticate(room, hash) {
  const member = room.members.find((m) => m.hash === hash);
  if (!member || member.left) throw new RuleError('INVALID_SESSION', 401);
  return member;
}
export function effectiveStatus(room, now) { return room.status === 'countdown' && now >= room.startsAt ? 'racing' : room.status; }
export function transition(room, member, action, body, now) {
  const status = effectiveStatus(room, now);
  room.status = status;
  if (['start', 'cancel', 'reset'].includes(action) && !member.host) throw new RuleError('HOST_ONLY', 403);
  if (action === 'start') {
    if (status !== 'lobby') throw new RuleError('ROOM_NOT_IN_LOBBY');
    if (!room.members.some((m) => m.participates && !m.left)) throw new RuleError('PLAYER_REQUIRED');
    room.status = 'countdown'; room.startsAt = now + 3000;
    return { started: true };
  }
  if (action === 'cancel') {
    if (!['lobby', 'countdown', 'racing'].includes(status)) throw new RuleError('RACE_NOT_ACTIVE');
    room.status = 'cancelled'; room.endedAt = now; return { cancelled: true };
  }
  if (action === 'reset') {
    if (!['finished', 'cancelled'].includes(status)) throw new RuleError('RACE_NOT_FINISHED');
    room.sequence = generateSequence(room.difficulty, room.rounds, undefined, room.sequence);
    room.members = room.members.filter((m) => !m.left);
    room.members.forEach((m) => { m.progress = freshProgress(); });
    room.raceId = newId(); room.status = 'lobby'; room.startsAt = null; room.endedAt = null; room.winnerId = null;
    return { reset: true };
  }
  if (action === 'leave') {
    if (status === 'closed') throw new RuleError('ROOM_CLOSED');
    if (member.host) { room.status = 'closed'; room.endedAt ??= now; }
    member.left = true;
    if (status === 'lobby' && !member.host) room.members = room.members.filter((m) => m.id !== member.id);
    if (['countdown', 'racing'].includes(status) && !room.members.some((m) => m.participates && !m.left)) { room.status = member.host ? 'closed' : 'cancelled'; room.endedAt = now; }
    return { left: true };
  }
  if (!member.participates) throw new RuleError('PLAYER_REQUIRED', 403);
  if (status !== 'racing') throw new RuleError(status === 'finished' ? 'RACE_FINISHED' : 'RACE_NOT_ACTIVE');
  const outcome = applyRound(member.progress, room.sequence[member.progress.roundIndex], action, body, now, room.rounds);
  if (outcome.final) { room.status = 'finished'; room.winnerId = member.id; room.endedAt = now; }
  return outcome;
}
export function join(room, body, hash) {
  if (room.status !== 'lobby') throw new RuleError('ROOM_NOT_IN_LOBBY');
  const name = normalizeName(body.name);
  if (room.members.some((m) => !m.left && nameKey(m.name) === nameKey(name))) throw new RuleError('NAME_TAKEN');
  if (room.members.filter((m) => m.participates && !m.left).length >= 30) throw new RuleError('ROOM_FULL');
  const member = { id: newId(), name, hash, host: false, participates: true, left: false, joinOrder: room.nextJoinOrder++, progress: freshProgress() };
  room.members.push(member);
  return member;
}
export function standings(room) {
  return room.members.filter((m) => m.participates).sort((a, b) => Number(b.id === room.winnerId) - Number(a.id === room.winnerId) || b.progress.completed - a.progress.completed || b.progress.points - a.progress.points || (a.progress.latestCorrectAt ?? Infinity) - (b.progress.latestCorrectAt ?? Infinity) || a.joinOrder - b.joinOrder);
}
export function project(room, member, now, presence = {}) {
  const status = effectiveStatus(room, now);
  const common = { code: room.code, raceId: room.raceId, roomVersion: room.version, serverNow: now, expiresAt: room.expiresAt, difficulty: room.difficulty, rounds: room.rounds, occupancy: room.members.filter((m) => m.participates && !m.left).length, capacity: 30, status, startsAt: room.startsAt, endedAt: room.endedAt };
  if (!member) return common;
  const summary = (m) => ({ id: m.id, name: m.name, host: m.host, participates: m.participates, left: m.left, completed: m.progress.completed, points: m.progress.points, attempts: m.progress.attempts, wrongAttempts: m.progress.wrongAttempts, hints: m.progress.hints, latestCorrectAt: m.progress.latestCorrectAt, lastSeen: presence[m.id] ?? null });
  const p = member.progress;
  const me = { ...summary(member), roundIndex: p.roundIndex, phase: p.phase, round: p.round, history: p.history };
  if (member.participates && status === 'racing' && p.phase === 'answering') {
    const c = room.sequence[p.roundIndex];
    me.challenge = { ciphertext: c.ciphertext };
    me.unlockedHints = Array.from({ length: p.round.hints }, (_, i) => hintText(c, i + 1));
  }
  return { ...common, winnerId: room.winnerId, members: room.members.map(summary), standings: standings(room).map(summary), me };
}
