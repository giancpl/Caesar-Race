import { generateSequence } from '../challenges/generate.js';
import { freshProgress, applyRound, hintText } from '../core/rules.js';
import { storage, SOLO_SESSION } from '../transport/session.js';
export function createSolo(difficulty, rounds, previous = []) {
  const game = { version: 1, id: crypto.randomUUID(), difficulty, rounds, sequence: generateSequence(difficulty, rounds, undefined, previous), progress: freshProgress(), startsAt: Date.now() + 3000, endedAt: null };
  saveSolo(game); return game;
}
export function saveSolo(game) { storage.set(SOLO_SESSION, game); }
export function loadSolo() {
  const game = storage.get(SOLO_SESSION);
  const p = game?.progress;
  if (game?.version !== 1 || !['easy', 'hard'].includes(game.difficulty) || !Number.isInteger(game.rounds) || game.rounds < 1 || game.rounds > 10 || !Array.isArray(game.sequence) || game.sequence.length !== game.rounds || !p || !Number.isInteger(p.roundIndex) || p.roundIndex < 0 || p.roundIndex >= game.rounds || !['answering', 'solved'].includes(p.phase) || !Array.isArray(p.history) || !p.round || !Number.isFinite(game.startsAt) || game.sequence.some((c) => typeof c.plaintext !== 'string' || typeof c.ciphertext !== 'string' || !Number.isInteger(c.key) || c.key < 1 || c.key > 25)) return null;
  return game;
}
export function clearSolo() { storage.remove(SOLO_SESSION); }
export function actSolo(game, action, extra) {
  if (Date.now() < game.startsAt || game.endedAt) throw new Error('RACE_NOT_ACTIVE');
  const result = applyRound(game.progress, game.sequence[game.progress.roundIndex], action, { roundIndex: game.progress.roundIndex, ...extra }, Date.now(), game.rounds);
  if (result.final) {
    game.endedAt = Date.now();
    const records = storage.get('caesar-race:results:v1', true);
    storage.set('caesar-race:results:v1', [{ id: game.id, difficulty: game.difficulty, rounds: game.rounds, points: game.progress.points, elapsed: game.endedAt - game.startsAt }, ...(Array.isArray(records) ? records : [])].slice(0, 20), true);
  }
  saveSolo(game); return result;
}
export function soloView(game) {
  const p = game.progress;
  const status = game.endedAt ? 'finished' : Date.now() < game.startsAt ? 'countdown' : 'racing';
  const me = { ...p, id: 'solo', name: 'You', host: false, participates: true, left: false };
  if (status === 'racing' && p.phase === 'answering') { me.challenge = { ciphertext: game.sequence[p.roundIndex].ciphertext }; me.unlockedHints = Array.from({ length: p.round.hints }, (_, i) => hintText(game.sequence[p.roundIndex], i + 1)); }
  return { code: null, raceId: game.id, roomVersion: 0, serverNow: Date.now(), difficulty: game.difficulty, rounds: game.rounds, status, startsAt: game.startsAt, endedAt: game.endedAt, winnerId: game.endedAt ? 'solo' : null, members: [me], standings: [me], me };
}
