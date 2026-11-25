import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, normalizeAnswer, validAnswer, roundScore, freshProgress, applyRound, hintText } from '../../src/core/rules.js';
import { banks } from '../../src/challenges/banks.js';
import { generateSequence, validateBanks } from '../../src/challenges/generate.js';
test('every shift round-trips ASCII and preserves all other characters', () => {
  for (let key = 0; key < 26; key++) {
    const plain = 'Az Za, hello! 42 éΩ🙂\t\n';
    assert.equal(decrypt(encrypt(plain, key), key), plain);
    assert.equal(encrypt(' 42 éΩ🙂!', key), ' 42 éΩ🙂!');
  }
  assert.equal(encrypt('Zz Aa', 1), 'Aa Bb'); assert.equal(decrypt('Abc', 1), 'Zab');
});
test('cipher rejects invalid keys and inputs', () => {
  for (const key of [-1, 26, 1.5, '3', NaN]) assert.throws(() => encrypt('ABC', key));
  assert.throws(() => encrypt(null, 3)); assert.throws(() => decrypt('abc', 30));
});
test('normalization folds ASCII case and whitespace only', () => {
  assert.equal(normalizeAnswer('  HeLLo\t world!\n'), 'hello world!');
  assert.notEqual(normalizeAnswer('Hello!'), normalizeAnswer('Hello.'));
  assert.notEqual(normalizeAnswer('É'), normalizeAnswer('é'));
});
test('invalid submissions do not alter progress', () => {
  const progress = freshProgress(); const original = structuredClone(progress);
  for (const answer of ['', '   ', '!?', null, {}, 4, 'a'.repeat(241), 'a\u0000', 'a\u200b']) {
    assert.equal(validAnswer(answer), false);
    assert.throws(() => applyRound(progress, { plaintext: 'Hello.' }, 'answer', { roundIndex: 0, answer }, 1, 3));
    assert.deepEqual(progress, original);
  }
  assert.equal(validAnswer('Hello\tworld\n!'), true);
});
test('score formula and floor', () => {
  assert.equal(roundScore(0, 0), 100); assert.equal(roundScore(3, 4), 62); assert.equal(roundScore(3, 100), 20);
});
test('sequential hints charge once; solved feedback requires Next', () => {
  const p = freshProgress(); const c = { plaintext: 'Hello world.', key: 3 };
  assert.throws(() => applyRound(p, c, 'hint', { roundIndex: 0, hintNumber: 2 }, 1, 2));
  for (let number = 1; number <= 3; number++) {
    applyRound(p, c, 'hint', { roundIndex: 0, hintNumber: number }, 1, 2);
    applyRound(p, c, 'hint', { roundIndex: 0, hintNumber: number }, 1, 2);
  }
  assert.equal(p.hints, 3); assert.match(hintText(c, 2), /Hello/); assert.match(hintText(c, 3), /3/);
  assert.equal(applyRound(p, c, 'answer', { roundIndex: 0, answer: 'wrong' }, 5, 2).correct, false);
  const result = applyRound(p, c, 'answer', { roundIndex: 0, answer: '  HELLO\tworld. ' }, 10, 2);
  assert.deepEqual(result, { correct: true, score: 68, final: false }); assert.equal(p.attempts, 2); assert.equal(p.roundIndex, 0);
  assert.throws(() => applyRound(p, c, 'answer', { roundIndex: 0, answer: c.plaintext }, 11, 2));
  applyRound(p, c, 'next', { roundIndex: 0 }, 20, 2); assert.equal(p.roundIndex, 1); assert.equal(p.round.hints, 0);
  assert.throws(() => applyRound(p, c, 'next', { roundIndex: 0 }, 20, 2));
  assert.equal(applyRound(p, c, 'answer', { roundIndex: 1, answer: c.plaintext }, 30, 2).final, true);
});
test('curated banks and deterministic sequence constraints', () => {
  assert.equal(validateBanks(), true);
  for (const difficulty of ['easy', 'hard']) {
    assert.ok(banks[difficulty].length >= 20);
    const random = (max) => max - 1;
    const a = generateSequence(difficulty, 10, random); const b = generateSequence(difficulty, 10, random);
    assert.deepEqual(a, b); assert.equal(new Set(a.map((c) => c.id)).size, 10);
    for (const c of a) { assert.ok(c.key >= 1 && c.key <= 25); assert.equal(decrypt(c.ciphertext, c.key), c.plaintext); }
    assert.notDeepEqual(generateSequence(difficulty, 10, random, a), a);
  }
  for (const rounds of [0, 11, '3', 1.1]) assert.throws(() => generateSequence('easy', rounds));
});
