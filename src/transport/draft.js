import { storage } from './session.js';

const storageKey = (scope) => `caesar-race:${scope}:draft:v1`;
export const draftIdentity = (view) => view?.me ? [view.code || 'solo', view.raceId, view.me.id, view.me.roundIndex].join(':') : '';

export function loadDraft(scope, identity) {
  const saved = storage.get(storageKey(scope));
  if (saved?.identity !== identity) return { draft: '', shift: 0 };
  return {
    draft: typeof saved.draft === 'string' ? saved.draft.slice(0, 480) : '',
    shift: Number.isInteger(saved.shift) && saved.shift >= 0 && saved.shift <= 25 ? saved.shift : 0
  };
}

export function saveDraft(scope, identity, draft, shift) {
  if (identity) storage.set(storageKey(scope), { identity, draft, shift });
}
