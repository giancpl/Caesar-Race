export const RULES_VERSION = 'caesar-v1';
const forbidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u;

export function encrypt(text, key) {
  if (typeof text !== 'string' || !Number.isInteger(key) || key < 0 || key > 25) throw new TypeError('Invalid cipher input');
  return text.replace(/[A-Za-z]/g, (letter) => {
    const base = letter <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + (letter.charCodeAt(0) - base + key) % 26);
  });
}
export function decrypt(text, key) {
  if (!Number.isInteger(key) || key < 0 || key > 25) throw new TypeError('Invalid shift');
  return encrypt(text, (26 - key) % 26);
}
export function normalizeAnswer(value) {
  return value.trim().replace(/\s+/g, ' ').replace(/[A-Z]/g, (char) => char.toLowerCase());
}
export function validAnswer(value) {
  return typeof value === 'string' && [...value].length <= 240 && /[a-z]/i.test(value) && !forbidden.test(value);
}
export function roundScore(hints, wrong) { return Math.max(20, 100 - 10 * hints - 2 * wrong); }
export function freshProgress() {
  return { roundIndex: 0, phase: 'answering', completed: 0, points: 0, attempts: 0, wrongAttempts: 0, hints: 0, latestCorrectAt: null, history: [], round: { attempts: 0, wrongAttempts: 0, hints: 0 } };
}
export function hintText(challenge, number) {
  if (number === 1) return 'Move each letter backward by the same number of places. Wrap A back to Z; keep spaces and punctuation.';
  if (number === 2) return `The first word is “${challenge.plaintext.match(/^[A-Za-z]+/)[0]}”.`;
  if (number === 3) return `The encryption key is ${challenge.key}. Move letters backward by ${challenge.key}.`;
  throw new TypeError('Invalid hint');
}
export class RuleError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export function applyRound(progress, challenge, action, data, now, totalRounds) {
  if (data.roundIndex !== progress.roundIndex) throw new RuleError('STALE_ROUND');
  if (action === 'next') {
    if (progress.phase !== 'solved' || progress.completed >= totalRounds) throw new RuleError('ROUND_NOT_SOLVED');
    progress.roundIndex += 1;
    progress.phase = 'answering';
    progress.round = { attempts: 0, wrongAttempts: 0, hints: 0 };
    return { advanced: true };
  }
  if (progress.phase !== 'answering') throw new RuleError('ROUND_ALREADY_SOLVED');
  if (action === 'hint') {
    if (!Number.isInteger(data.hintNumber) || data.hintNumber < 1 || data.hintNumber > 3) throw new RuleError('INVALID_HINT', 400);
    if (data.hintNumber > progress.round.hints + 1) throw new RuleError('HINT_OUT_OF_ORDER');
    if (data.hintNumber > progress.round.hints) { progress.round.hints++; progress.hints++; }
    return { hintNumber: data.hintNumber, text: hintText(challenge, data.hintNumber) };
  }
  if (action !== 'answer' || !validAnswer(data.answer)) throw new RuleError('INVALID_ANSWER', 400);
  progress.attempts++;
  progress.round.attempts++;
  const correct = normalizeAnswer(data.answer) === normalizeAnswer(challenge.plaintext);
  if (!correct) { progress.wrongAttempts++; progress.round.wrongAttempts++; return { correct: false }; }
  const score = roundScore(progress.round.hints, progress.round.wrongAttempts);
  progress.points += score;
  progress.completed++;
  progress.latestCorrectAt = now;
  progress.phase = 'solved';
  progress.history.push({ roundIndex: progress.roundIndex, plaintext: challenge.plaintext, key: challenge.key, score, solvedAt: now, ...progress.round });
  return { correct: true, score, final: progress.completed === totalRounds };
}
