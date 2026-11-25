import { banks, BANK_VERSION } from './banks.js';
import { encrypt, normalizeAnswer, RULES_VERSION } from '../core/rules.js';
export { BANK_VERSION };
export function secureInt(max) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError('Invalid random bound');
  const buffer = new Uint32Array(1);
  const limit = Math.floor(4294967296 / max) * max;
  do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % max;
}
export function validateBanks() {
  const seen = new Set();
  for (const [difficulty, entries] of Object.entries(banks)) {
    if (entries.length < 20) throw new Error('Not enough messages');
    for (const entry of entries) {
      const words = entry.plaintext.split(/\s+/).length;
      const [min, max] = difficulty === 'easy' ? [3, 6] : [7, 12];
      const normalized = normalizeAnswer(entry.plaintext);
      if (seen.has(entry.id) || seen.has(normalized) || words < min || words > max || entry.plaintext.length > 120 || !/^[A-Za-z]+\b/.test(entry.plaintext)) throw new Error(`Invalid message: ${entry.id}`);
      seen.add(entry.id); seen.add(normalized);
    }
  }
  return true;
}
export function generateSequence(difficulty, rounds, randomInt = secureInt, previous = []) {
  if (!banks[difficulty] || !Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new TypeError('Invalid settings');
  const pool = [...banks[difficulty]];
  for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const result = pool.slice(0, rounds).map((entry) => { const key = 1 + randomInt(25); return { ...entry, key, ciphertext: encrypt(entry.plaintext, key), bankVersion: BANK_VERSION, rulesVersion: RULES_VERSION }; });
  if (JSON.stringify(result) === JSON.stringify(previous)) { result[0].key = result[0].key % 25 + 1; result[0].ciphertext = encrypt(result[0].plaintext, result[0].key); }
  return result;
}
