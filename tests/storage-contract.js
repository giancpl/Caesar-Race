import assert from 'node:assert/strict';
export async function storageContract(storage, prefix, now) {
  const expiresAt = now + 60000; const roomKey = `${prefix}:room`; const bootstrapKey = `${prefix}:bootstrap`;
  const room = { version: 1, expiresAt };
  assert.equal((await storage.create(roomKey, room, bootstrapKey, 'first')).created, true);
  assert.equal((await storage.create(roomKey, room, `${prefix}:other-bootstrap`, 'other')).collision, true);
  assert.equal((await storage.get(roomKey)).version, 1);
  const replay = await storage.create(roomKey, room, bootstrapKey, 'first'); assert.equal(replay.existing.fingerprint, 'first');
  const receiptKey = `${prefix}:receipt`; const next = { ...room, version: 2 };
  const commits = await Promise.all([storage.commit(roomKey, 1, next, receiptKey, { fingerprint: 'f', outcome: { accepted: true } }), storage.commit(roomKey, 1, next, `${prefix}:losing-receipt`, { fingerprint: 'q' })]);
  assert.equal(commits.filter((r) => r.committed).length, 1);
  assert.equal((await storage.get(roomKey)).version, 2);
  const winner = commits[0].committed ? receiptKey : `${prefix}:losing-receipt`;
  const replayCommit = await storage.commit(roomKey, 1, next, winner, { fingerprint: 'ignored' });
  assert.ok(replayCommit.receipt);
  const presence = await storage.presence(`${prefix}:presence`, 'member', now, expiresAt); assert.equal(presence.member, now);
  assert.equal((await storage.limit(`${prefix}:limit`, 1, 60000)).allowed, true);
  assert.equal((await storage.limit(`${prefix}:limit`, 1, 60000)).allowed, false);
}
