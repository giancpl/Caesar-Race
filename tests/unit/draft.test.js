import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../../src/transport/session.js';
import { draftIdentity, loadDraft, saveDraft } from '../../src/transport/draft.js';

test('draft recovery is isolated by room, race, player, round and solo scope', () => {
  const view = { code: 'ABC234', raceId: 'race-one', me: { id: 'player-one', roundIndex: 0 } };
  const identity = draftIdentity(view);
  saveDraft('room', identity, 'My unfinished answer', 7);
  assert.deepEqual(loadDraft('room', identity), { draft: 'My unfinished answer', shift: 7 });
  for (const changed of [
    { ...view, code: 'XYZ234' }, { ...view, raceId: 'race-two' },
    { ...view, me: { ...view.me, id: 'player-two' } }, { ...view, me: { ...view.me, roundIndex: 1 } }
  ]) assert.deepEqual(loadDraft('room', draftIdentity(changed)), { draft: '', shift: 0 });
  assert.deepEqual(loadDraft('solo', identity), { draft: '', shift: 0 });
  storage.remove('caesar-race:room:draft:v1');
});

test('malformed saved drafts are bounded and cannot restore an invalid shift', (t) => {
  t.mock.method(storage, 'get', () => ({ identity: 'test', draft: 'x'.repeat(1000), shift: -1 }));
  assert.deepEqual(loadDraft('room', 'test'), { draft: 'x'.repeat(480), shift: 0 });
});
