import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../../server/storage/memory.js';
import { storageContract } from '../storage-contract.js';
test('memory adapter satisfies the shared storage contract', async () => { const now = Date.now(); await storageContract(new MemoryStorage({ clock: () => now }), 'caesar-race:test:memory', now); });
test('expired storage keys cannot be revived by a late commit', async () => {
  let now = 100; const store = new MemoryStorage({ clock: () => now });
  await store.create('room', { version: 1, expiresAt: 200 }, 'bootstrap', 'f'); now = 200;
  assert.equal(await store.get('room'), null); assert.equal(await store.get('bootstrap'), null);
  assert.deepEqual(await store.commit('room', 1, { version: 2, expiresAt: 300 }, 'receipt', {}), { conflict: true });
});
