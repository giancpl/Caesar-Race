import './styles/app.css';
import { h, button, badge, dialog } from './ui/dom.js';
import { icon, shiftIllustration } from './ui/visual.js';
import { cipherWheel } from './ui/wheel.js';
import { decrypt } from './core/rules.js';
import { RoomClient } from './transport/api.js';
import { storage, SOLO_SESSION } from './transport/session.js';
import { draftIdentity, loadDraft, saveDraft } from './transport/draft.js';

const client = new RoomClient();
const app = document.querySelector('#app');
const announcements = h('div', { id: 'announcement', className: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
document.body.append(announcements);
let route = location.hash.slice(1) || 'home';
let room = null;
let solo = null;
let soloEngine;
let busy = false;
let error = '';
let roomProblem = '';
let sync = 'online';
let failures = 0;
let pollTimer;
let polling = false;
let draft = '';
let shift = 0;
let renderedKey = '';
let preview = null;
let offset = 0;
let uiGeneration = 0;
let draftKey = '';
let suspended = false;
const routes = ['home', 'solo-setup', 'create', 'join', 'solo', 'room'];

const messages = {
  INVALID_NAME: 'Choose a name with 1–24 characters and no control characters.', NAME_TAKEN: 'That name is taken. Try another name.',
  ROOM_FULL: 'This room already has 30 players.', ROOM_NOT_IN_LOBBY: 'Joining has closed because this race has already started.',
  ROOM_UNAVAILABLE: 'This room is unavailable. Check the code, or ask the host for a new room.', ROOM_EXPIRED: 'This room has expired. Ask the host to create a new one.',
  INVALID_SESSION: 'Your session is no longer valid. You can join a lobby again or play solo.', INVALID_ROOM_CODE: 'Enter the six-character room code.',
  NETWORK_ERROR: 'Connection interrupted. Your answer is still here. Retry to recover the server result.', STORAGE_UNAVAILABLE: 'Multiplayer storage is unavailable. Retry shortly, or play solo.',
  ROOM_CONFLICT: 'The room changed while your request was processed. Retry safely.', STALE_RACE: 'A rematch has started. Refreshing your room state.',
  STALE_ROUND: 'Your round changed. Refreshing your progress.', RACE_FINISHED: 'The race has finished. Loading the final standings.',
  INVALID_ANSWER: 'Enter a message with letters, up to 240 characters. Spaces and punctuation must match.',
  RATE_LIMITED: 'Too many requests. Wait a moment before trying again.', PENDING_REQUEST: 'Recover your pending request before taking another action.',
  INVALID_RESPONSE: 'The server returned an unreadable response. Retry to recover safely.',
  SESSION_EXISTS: 'A room session is already saved in this tab. Resume it before creating or joining another room.',
  PLAYER_REQUIRED: 'At least one player is needed to start.', REQUEST_CONFLICT: 'This request conflicts with an earlier request. Refresh to recover your session.',
  HOST_ONLY: 'Only the host can use this control.', ROOM_VERSION_UNSUPPORTED: 'This room uses an unsupported version. Please create a new room.',
  SECURE_CONTEXT_REQUIRED: 'This browser does not provide secure random values. Use a current browser or open the game over HTTPS.'
};

const formatTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const currentView = () => route === 'solo' ? solo && soloEngine ? soloEngine.soloView(solo) : null : room;
function persistDraft() {
  const view = currentView();
  if (['room', 'solo'].includes(route) && view?.me && draftKey === `${route}:${draftIdentity(view)}`) saveDraft(route, draftKey, draft, shift);
}

function announce(text) { if (!suspended) announcements.textContent = text; }
function setError(err) {
  if (suspended || err.code === 'SESSION_CHANGED') return;
  error = messages[err.code || err.message] || 'Something went wrong. Please retry.';
  if (route === 'room' && ['INVALID_SESSION', 'ROOM_UNAVAILABLE', 'ROOM_EXPIRED', 'ROOM_VERSION_UNSUPPORTED'].includes(err.code)) roomProblem = err.code;
  if (err.retryAfter) error += ` Try again in ${err.retryAfter} seconds.`;
  updateNotice();
}
function updateNotice() {
  if (suspended) return;
  const node = document.querySelector('#notice'); if (!node) return;
  node.replaceChildren(); node.hidden = !error && sync === 'online';
  node.className = `notice${error ? ' notice--error' : sync !== 'online' ? ' notice--warn' : ''}`;
  if (error) node.append(h('p', {}, error));
  if (sync !== 'online') node.append(h('p', {}, sync === 'reconnecting' ? 'Reconnecting… your progress is saved on the server.' : 'Connection unavailable. Your answer has been preserved.'));
  if (client.session && (client.session.bootstrap || client.session.pending || route === 'room' && (error || sync !== 'online'))) node.append(button('Retry connection', () => recoverRoom(), { className: 'button secondary small' }));
}
function acceptRoom(next) {
  if (room && room.code === next.code && next.roomVersion < room.roomVersion) return;
  const old = room;
  room = next; offset = client.offset; roomProblem = '';
  if (old && old.status !== 'finished' && next.status === 'finished') announce('The race has finished. Final standings are ready.');
}
async function task(work) {
  if (busy) return;
  busy = true; error = ''; updateNotice(); updateDisabled();
  try { await work(); }
  catch (err) { setError(err); }
  finally {
    busy = false; render(); updateDisabled(); schedulePoll(0);
    if (!suspended && route === 'solo' && !solo && !error) queueMicrotask(() => { if (!suspended && route === 'solo' && !solo) startSoloRecovery(); });
  }
}
function updateDisabled() {
  if (suspended) return;
  for (const control of document.querySelectorAll('[data-action]')) control.disabled = busy || (route === 'room' && Boolean(client.session?.pending)) || (control.hasAttribute('data-needs-player') && !room?.occupancy);
}
function navigate(next, { force = false, historyMode = 'push' } = {}) {
  if (suspended) return;
  if (next === route && !force) return;
  persistDraft();
  if (next !== route) for (const node of document.querySelectorAll('dialog[open]')) node.close();
  route = next; error = ''; sync = 'online'; renderedKey = '';
  const url = new URL(location.href);
  if (next === 'room') url.searchParams.delete('join');
  url.hash = next;
  if (historyMode !== 'none' && url.href !== location.href) history[historyMode === 'replace' ? 'replaceState' : 'pushState'](null, '', `${url.pathname}${url.search}${url.hash}`);
  render(); schedulePoll(0);
  if (!force && next === 'room') recoverRoom();
  if (!force && next === 'solo' && !solo) startSoloRecovery();
}

function leaveRoom() {
  const session = client.session;
  const view = room;
  if (!session || !view || busy || session.pending) return;
  const host = view.me?.host;
  dialog(host ? 'Close this room?' : 'Leave this room?', h('p', {}, host
    ? 'This closes the room for everyone and cannot be undone. Home, Back and refresh keep the room open.'
    : 'This ends your membership. You cannot rejoin after the countdown begins. Home, Back and refresh keep your place.'), {
    confirmText: host ? 'Close room' : 'Leave room', confirm: () => task(async () => {
      if (client.session !== session) return;
      const result = await client.mutate('leave', room);
      if (result.outcome?.left) { client.clear(); room = null; roomProblem = ''; navigate('home', { force: true, historyMode: 'replace' }); }
    })
  });
}

function savedRoomScreen() {
  return h('section', { className: 'narrow-card status-panel' },
    icon('key', 'outcome-icon--sm'),
    h('h1', {}, 'Your room session is saved'),
    h('p', {}, 'Home, Back and refresh keep your place. Resume your room to continue or explicitly leave before joining another room.'),
    button('Resume room', () => recoverRoom(), { className: 'button primary bp-btn--block', 'data-action': '' }));
}

function showRules() {
  let activeTab = route === 'room' || route === 'create' || route === 'join' ? 'multiplayer' : 'solo';
  const body = h('div', { className: 'bp-rules-modal__body' });
  const tabs = [
    { id: 'solo', label: 'How it works', desc: 'Cipher basics & scoring' },
    { id: 'multiplayer', label: 'Multiplayer race', desc: 'Rooms, pacing & security' }
  ];

  const soloContent = h('div', { id: 'rules-panel-solo', role: 'tabpanel', 'aria-labelledby': 'rules-tab-solo', className: 'prose' },
    h('h3', {}, 'Breaking the Caesar cipher'),
    h('p', {}, 'A Caesar cipher moves every letter by the same number of places. With encryption shift 3, A becomes D and Z becomes C. To decrypt, move backward.'),
    h('p', {}, 'Read the ciphertext, experiment, and enter the original message. Case and extra whitespace do not matter; punctuation does. Empty or malformed answers cost nothing.'),
    h('h3', {}, 'Easy vs. Hard & Scoring'),
    h('p', {}, 'Easy pairs the interactive wheel with a live preview and alphabet table. Hard gives you the wheel only. Each new hint costs 10 points; each wrong answer costs 2. A solved round earns at least 20 points.'),
    h('blockquote', {}, h('p', {}, 'Press Next Round after each solved message to advance through your sequence.')));

  const multiContent = h('div', { id: 'rules-panel-multiplayer', role: 'tabpanel', 'aria-labelledby': 'rules-tab-multiplayer', className: 'prose' },
    h('h3', {}, 'Shared race rules'),
    h('p', {}, 'In multiplayer, everyone receives the same messages and moves independently. The first final answer accepted by the server wins, regardless of points.'),
    h('h3', {}, 'A lesson in small secrets'),
    h('p', {}, 'There are only 26 possible shifts, including the unchanged alphabet. This game uses the 25 nonzero keys. Trying every shift is easy, and language patterns remain visible. A large key space alone does not guarantee security: the design must also resist attacks.'),
    h('p', {}, 'Server-authoritative scoring protects recorded results. Caesar is intentionally easy to solve with external tools; this is a learning game, not comprehensive anti-cheat protection.'));

  const tabButtons = {};
  const renderTab = (next) => {
    activeTab = next;
    for (const t of tabs) {
      const selected = t.id === activeTab;
      tabButtons[t.id].setAttribute('aria-selected', String(selected));
      tabButtons[t.id].className = `bp-rules-modal__tab${selected ? ' bp-rules-modal__tab--active' : ''}`;
      tabButtons[t.id].tabIndex = selected ? 0 : -1;
    }
    body.replaceChildren(activeTab === 'solo' ? soloContent : multiContent);
    body.scrollTop = 0;
  };

  const handleTabKeyDown = (event) => {
    const order = tabs.map((t) => t.id);
    const current = order.indexOf(activeTab);
    let next = null;
    if (event.key === 'ArrowRight') next = order[(current + 1) % order.length];
    else if (event.key === 'ArrowLeft') next = order[(current - 1 + order.length) % order.length];
    else if (event.key === 'Home') next = order[0];
    else if (event.key === 'End') next = order[order.length - 1];
    if (!next) return;
    event.preventDefault();
    renderTab(next);
    tabButtons[next].focus();
  };

  const tablist = h('div', { className: 'bp-rules-modal__tabs', role: 'tablist', 'aria-label': 'Rules sections', onKeydown: handleTabKeyDown },
    ...tabs.map((t) => {
      const btn = h('button', {
        type: 'button',
        id: `rules-tab-${t.id}`,
        role: 'tab',
        'aria-controls': `rules-panel-${t.id}`,
        onClick: () => renderTab(t.id)
      }, h('strong', {}, t.label), h('small', {}, t.desc));
      tabButtons[t.id] = btn;
      return btn;
    }));

  renderTab(activeTab);
  dialog('How to play', h('div', { className: 'bp-rules-modal__wrap' }, tablist, body), {
    subtitle: 'Cipher mechanics, scoring, and multiplayer races',
    className: 'bp-rules-modal'
  });
}

function shell(content, { minimal = false } = {}) {
  const main = h('main', { id: 'main', className: minimal ? 'main--play' : undefined, tabindex: '-1' }, h('div', { id: 'notice', className: 'notice', role: 'alert', hidden: true }), content);
  if (route === 'room' && room && !roomProblem && room.status !== 'closed') {
    main.append(h('details', { className: 'play-disclosure room-session-bar', id: 'room-session-controls' },
      h('summary', {}, 'Room session'),
      h('p', { className: 'hint' }, 'Home, Back and refresh keep your place in this tab.'),
      button(room.me?.host ? 'Close room' : 'Leave room', leaveRoom, { className: 'button danger small', 'data-action': '' })));
  }
  const nodes = [
    h('header', { className: 'topbar topbar--compact' },
      h('div', { className: 'topbar-inner' },
        h('div', { className: 'brand-group' },
          button(h('img', { src: '/brand/bitpolito-logo-blue.svg', alt: '', width: 172, height: 30 }), () => navigate('home'), { className: 'wordmark', 'aria-label': 'BitPolito home' }),
          h('span', { className: 'app-name' }, 'Caesar Race')),
        h('nav', { className: 'header-actions', 'aria-label': 'Main navigation' },
          route !== 'home' ? button('Home', () => navigate('home'), { className: 'button quiet' }) : null,
          button('How to play', showRules, { className: 'button quiet' })))),
    main
  ];
  if (!minimal) {
    nodes.push(h('footer', { className: 'footer' },
      h('div', { className: 'footer-inner' },
        h('span', { className: 'footer-brand' }, icon('cow'), 'Made for curious minds · BitPolito'))));
  }
  app.replaceChildren(...nodes);
  updateNotice();
}

function landing() {
  const resume = [];
  if (storage.get(SOLO_SESSION)) resume.push(button('Resume solo game', () => startSoloRecovery(), { className: 'button secondary small' }));
  if (client.session) resume.push(button('Recover room session', () => recoverRoom(), { className: 'button primary small' }));
  return h('div', { className: 'landing' },
    h('section', { className: 'hero' },
      h('div', { className: 'hero-copy' },
        badge('BITPOLITO · CRYPTOGRAPHY'),
        h('h1', {}, 'Caesar Race'),
        h('p', { className: 'lead' }, 'Crack the Caesar cipher solo or race friends.'))),
    h('section', { className: 'mode-grid', 'aria-label': 'Choose a game' },
      modeCard('crypto', 'Solo practice', 'Play Solo', 'Explore with the interactive wheel.', 'solo-setup', true),
      modeCard('share', 'Host a race', 'Create Room', 'Host up to 30 players.', 'create'),
      modeCard('key', 'Join a race', 'Join Room', 'Enter a room code to race.', 'join')),
    resume.length ? h('div', { className: 'resume-row bp-restore-banner' }, h('span', { className: 'bp-restore-banner__text' }, 'Saved session in this tab.'), h('div', { className: 'bp-restore-banner__actions' }, ...resume)) : null,
    shiftIllustration());
}

function modeCard(asset, heading, ctaLabel, description, target, primary = false) {
  return h('article', { className: `mode-card${primary ? ' featured' : ''}` },
    h('div', { className: 'card-top' }, icon(asset, 'card-symbol'), h('div', {}, h('h2', {}, heading), h('p', {}, description))),
    button(ctaLabel, () => navigate(target), { className: `button ${primary ? 'primary' : 'secondary'} bp-btn--block`, 'data-action': '' }));
}

function labelled(text, input, help) {
  return h('label', { className: 'field' }, h('span', { className: 'field-label' }, text), input, help ? h('span', { className: 'hint' }, help) : null);
}

function setup(isRoom) {
  if (isRoom && client.session) return savedRoomScreen();
  const difficulty = h('fieldset', { className: 'difficulty-picker' }, h('legend', {}, 'Difficulty'), ...['easy', 'hard'].map((value) => h('label', { className: 'difficulty-option' }, h('input', { id: `difficulty-${value}`, type: 'radio', name: 'difficulty', value, checked: value === 'easy' }), h('span', {}, h('strong', {}, value === 'easy' ? 'Easy' : 'Hard'), h('small', {}, value === 'easy' ? 'Wheel + live preview' : 'Wheel only')))));
  const roundsInput = h('input', { name: 'rounds', id: 'rounds', type: 'number', min: 1, max: 10, step: 1, value: 3, required: true });
  const presetButtons = [2, 3, 5, 8, 10].map((count) => button(String(count), () => {
    roundsInput.value = String(count);
    syncPresets();
  }, { className: 'button preset-pill', 'aria-pressed': String(count === 3), 'aria-label': `${count} rounds` }));
  const syncPresets = () => {
    const val = Number(roundsInput.value);
    for (const btn of presetButtons) btn.setAttribute('aria-pressed', String(Number(btn.textContent) === val));
  };
  roundsInput.addEventListener('input', syncPresets);

  const form = h('form', { className: 'setup-form', onSubmit: (event) => { event.preventDefault(); const data = new FormData(form); task(async () => {
    if (isRoom) {
      if (client.session?.bootstrap || client.session?.pending) throw new Error('PENDING_REQUEST');
      const result = await client.bootstrap('create', { name: data.get('name'), difficulty: data.get('difficulty'), rounds: Number(data.get('rounds')), participates: false });
      acceptRoom(result.room); if (route === 'create') navigate('room', { force: true });
    } else { soloEngine = await import('./solo/game.js'); solo = soloEngine.createSolo(data.get('difficulty'), Number(data.get('rounds'))); draft = ''; shift = 0; navigate('solo', { force: true }); }
  }); } },
  isRoom ? labelled('Host name', h('input', { name: 'name', id: 'host-name', required: true, maxlength: 48, autocomplete: 'nickname', value: 'BitPolito', placeholder: 'How should we call you?' })) : null,
  difficulty,
  h('div', { className: 'field' },
    h('label', { className: 'field-label', for: 'rounds' }, 'Rounds to complete'),
    roundsInput,
    h('div', { className: 'round-presets', role: 'group', 'aria-label': 'Quick round presets' }, ...presetButtons)),
  h('button', { className: 'button primary bp-btn--block', type: 'submit', 'data-action': '' }, isRoom ? 'Create room' : 'Start solo game'));
  return h('section', { className: 'narrow-card' },
    h('div', { className: 'narrow-head' },
      h('h1', {}, isRoom ? 'Create room' : 'Solo game'),
      h('p', { className: 'hint' }, isRoom ? 'You spectate; up to 30 players race.' : 'Choose difficulty and rounds.')),
    form);
}

function joinScreen() {
  if (client.session) return savedRoomScreen();
  const invite = new URLSearchParams(location.search).get('join') || '';
  const code = h('input', {
    id: 'room-code',
    className: 'input--code',
    name: 'code',
    required: true,
    maxlength: 12,
    value: preview?.code || invite.toUpperCase(),
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'ABC234',
    onInput: (event) => {
      const upper = event.target.value.toUpperCase();
      if (upper !== event.target.value) {
        const pos = event.target.selectionStart;
        event.target.value = upper;
        if (typeof pos === 'number') event.target.setSelectionRange(pos, pos);
      }
    }
  });
  const previewBox = h('div', { id: 'room-preview', className: 'preview-box', role: 'status' });
  const showPreview = () => { if (preview) previewBox.replaceChildren(h('strong', {}, `${preview.difficulty === 'easy' ? 'Easy' : 'Hard'} · ${preview.rounds} rounds`), h('p', {}, `${preview.occupancy}/30 players · ${preview.status === 'lobby' ? 'Open for joining' : 'Joining has closed'}`)); };
  const form = h('form', { onSubmit: (event) => { event.preventDefault(); task(async () => {
    if (client.session?.bootstrap || client.session?.pending) throw new Error('PENDING_REQUEST');
    const data = new FormData(form); const result = await client.bootstrap('join', { code: data.get('code'), name: data.get('name') });
    acceptRoom(result.room);
    if (route === 'join') { history.replaceState(null, '', `${location.pathname}#room`); navigate('room', { force: true }); }
  }); } },
  h('div', { className: 'field' },
    h('label', { className: 'field-label', for: 'room-code' }, 'Room code'),
    h('div', { className: 'code-check-row' },
      code,
      button('Check room', () => task(async () => { const data = await client.request('preview', { code: code.value }, null); preview = data.room; showPreview(); }), { className: 'button secondary small', 'data-action': '' }))),
  previewBox,
  labelled('Player name', h('input', { id: 'player-name', name: 'name', required: true, maxlength: 48, autocomplete: 'nickname', placeholder: 'Your name' })),
  h('button', { type: 'submit', className: 'button primary bp-btn--block', 'data-action': '' }, 'Join room'));
  showPreview();
  if (invite.trim() && !preview) {
    const gen = uiGeneration;
    client.request('preview', { code: invite.trim() }, null).then((data) => {
      if (gen === uiGeneration && route === 'join' && data?.room) {
        preview = data.room;
        showPreview();
      }
    }).catch(() => {});
  }
  return h('section', { className: 'narrow-card' },
    h('div', { className: 'narrow-head' },
      h('h1', {}, 'Join room'),
      h('p', { className: 'hint' }, 'Enter a 6-character code or scan a room QR.')),
    form);
}

function connection(member) {
  const age = member.lastSeen ? Date.now() + offset - member.lastSeen : Infinity;
  return member.left ? 'Left' : age <= 15000 ? 'Connected recently' : age <= 60000 ? 'Inactive' : 'Disconnected or tab hidden';
}

function raceBar(completed, total, won = false, label = '') {
  return h('progress', {
    className: `bp-race-bar${won ? ' bp-race-bar--won' : ''}`,
    max: Math.max(1, total),
    value: Math.max(0, Math.min(total, completed)),
    'aria-label': label || `${completed} of ${total}`,
    'aria-hidden': label ? undefined : 'true'
  });
}

function dashboard(view, final = false) {
  const list = h('ol', { className: `standings${view.status === 'lobby' ? ' standings--lobby' : ''}`, id: 'progress-list', 'aria-label': final ? 'Final standings' : 'Live progress' });
  fillProgress(list, view, final);
  return h('section', { className: 'standings-section' },
    h('div', { className: 'section-head' },
      h('h2', {}, final ? 'Final standings' : view.status === 'lobby' ? 'Players in lobby' : 'Live standings'),
      h('span', { className: 'badge', 'data-occupancy': '' }, `${view.occupancy ?? 1}/30 players`)),
    list);
}

function fillProgress(list, view, final = false) {
  const players = view.standings || [];
  const isLobby = view.status === 'lobby';
  list.replaceChildren(...(players.length ? players.map((m, i) => {
    const isLeading = !isLobby && i === 0 && m.completed > 0;
    const isWinner = m.id === view.winnerId;
    return h('li', { className: `progress-row${isWinner ? ' winner' : isLeading ? ' progress-row--leading' : ''}` },
      !isLobby ? h('span', { className: 'rank' }, i + 1) : h('span', { className: 'lobby-player-tile', 'aria-hidden': 'true' }, icon('crypto')),
      h('div', { className: 'player-body' },
        h('div', { className: 'player-identity' },
          h('strong', {}, m.name, m.id === view.me?.id ? h('span', { className: 'player-you' }, ' (you)') : ''),
          isLobby ? h('span', { className: 'player-status-pill' }, connection(m)) : null),
        !isLobby ? raceBar(m.completed, view.rounds, isWinner) : null,
        !isLobby && (m.left || (final && !isWinner) || !m.connected)
          ? h('small', {}, m.left ? 'Left' : final && !isWinner ? 'Did not finish' : connection(m))
          : null,
        !isLobby && m.latestCorrectAt ? h('small', { className: 'player-activity' }, `Last solve ${formatTime(m.latestCorrectAt - view.startsAt)}`) : null),
      !isLobby ? h('div', { className: 'player-score' }, h('strong', {}, `${m.completed}/${view.rounds}`), h('small', {}, `${m.points} pts`)) : null);
  }) : [h('li', { className: 'empty-state' }, 'No players yet. Share your code or QR to invite.')]));
}

function hostControls(view) {
  if (!view.me?.host) return null;
  return h('div', { className: 'host-controls' },
    view.status === 'lobby' ? button('Start race', () => multiplayerAction('start'), { className: 'button primary bp-btn--block', 'data-action': '', 'data-needs-player': '', disabled: view.occupancy < 1 || busy }) : null,
    ['finished', 'cancelled'].includes(view.status) ? button('Prepare rematch', () => multiplayerAction('reset'), { className: 'button primary', 'data-action': '' }) : null,
    ['lobby', 'countdown', 'racing'].includes(view.status) ? button('Cancel race', () => dialog('Cancel this race?', h('p', {}, 'Progress will be frozen without a winner. You can prepare a rematch later.'), { confirmText: 'Cancel race', confirm: () => multiplayerAction('cancel') }), { className: 'button danger', 'data-action': '' }) : null);
}

function invitation(view) {
  const url = `${location.origin}/?join=${view.code}`;
  const fallback = h('div', { className: 'copy-fallback' });
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      announce('Copied to clipboard.');
      fallback.replaceChildren(h('p', { role: 'status', className: 'copy-status' }, 'Copied to clipboard.'));
    } catch {
      fallback.replaceChildren(labelled('Select and copy', h('input', { readonly: true, value, onFocus: (e) => e.target.select() })));
    }
  }
  const qr = h('div', { className: 'qr-placeholder', 'aria-label': 'Invitation QR code' }, 'Preparing QR…');
  const generation = uiGeneration;
  import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 400, margin: 2, errorCorrectionLevel: 'M' })).then((src) => {
    if (generation !== uiGeneration) return;
    const image = h('img', { src, alt: 'Scan to open the room invitation', width: 136, height: 136 });
    qr.replaceChildren(button('', () => dialog('Scan to join', h('div', { className: 'qr-dialog' }, h('img', { src, alt: `Invitation for room ${view.code}`, width: 400, height: 400 }), h('p', {}, view.code))), { className: 'qr-button', 'aria-label': 'Enlarge invitation QR code' }));
    qr.firstChild.append(image);
  }).catch(() => qr.replaceChildren(h('p', {}, 'Use the room code or link to join.')));
  return h('section', { className: 'invite-card' },
    h('div', { className: 'invite-details' },
      h('span', { className: 'eyebrow' }, 'ROOM CODE'),
      h('div', { className: 'room-code input--code' }, view.code),
      h('div', { className: 'button-row' },
        button('Copy code', () => copy(view.code), { className: 'button secondary small' }),
        button('Copy link', () => copy(url), { className: 'button secondary small' })),
      h('details', {}, h('summary', {}, 'Show invitation link'), h('a', { href: url, className: 'invite-link' }, url)),
      fallback),
    h('div', { className: 'qr-wrap' }, qr));
}

function lobby(view) {
  const hostName = view.members.find((m) => m.host)?.name || 'Host';
  const controlCard = h('section', { className: 'lobby-controls' },
    h('div', { className: 'lobby-controls__meta' },
      h('span', { className: 'badge' }, view.difficulty === 'easy' ? 'Easy' : 'Hard'),
      h('span', { className: 'badge' }, `${view.rounds} rounds`),
      h('span', { className: 'lobby-controls__host' }, `Host: ${hostName}`)),
    hostControls(view),
    view.me?.host
      ? h('p', { className: 'hint', role: 'status', 'data-invite-empty': '', hidden: view.occupancy > 0 }, 'Invite at least one player to start.')
      : h('p', { className: 'hint' }, 'Waiting for the host to start the countdown.'));

  return h('div', { className: 'lobby-stage' },
    h('div', { className: 'lobby-head' },
      badge(view.me?.host ? 'YOU ARE THE HOST' : 'READY TO RACE'),
      h('h1', {}, 'A little anticipation.'),
      h('p', { className: 'hint' }, 'Everyone gets the same messages. Share the code to gather players.')),
    h('div', { className: 'lobby-grid' }, invitation(view), controlCard),
    dashboard(view));
}

function inlineStats(view) {
  const me = view.me;
  const elapsed = formatTime((view.endedAt || Date.now() + (route === 'room' ? offset : 0)) - view.startsAt);
  return h('div', { className: 'play-hud__stats', 'aria-label': 'Your race statistics' },
    h('span', { className: 'play-hud__stat' }, h('span', { className: 'play-hud__label' }, 'Done '), h('strong', { id: 'round-stat' }, `${me.completed}/${view.rounds}`)),
    h('span', { className: 'play-hud__stat' }, h('span', { className: 'play-hud__label' }, 'Pts '), h('strong', { id: 'points-stat' }, me.points)),
    h('span', { className: 'play-hud__stat' }, h('span', { className: 'play-hud__label' }, 'Tries '), h('strong', { id: 'attempts-stat' }, me.attempts)),
    h('span', { className: 'play-hud__stat' }, h('span', { className: 'play-hud__label' }, 'Hints '), h('strong', { id: 'hints-stat' }, me.hints)),
    h('span', { className: 'play-hud__stat' }, h('strong', { id: 'elapsed' }, elapsed)));
}

function playHud(view, headingText, progressCount) {
  const isEasy = view.difficulty === 'easy';
  return h('header', { className: 'play-hud' },
    h('h1', { className: 'sr-only' }, headingText),
    h('div', { className: 'play-hud__row' },
      h('div', { className: 'play-hud__badges' },
        badge(`MESSAGE ${Math.min(view.me.roundIndex + 1, view.rounds)} OF ${view.rounds}`),
        badge(isEasy ? 'EASY' : 'HARD', isEasy ? '' : 'badge--hard'),
        route === 'room' ? badge(`ROOM ${view.code}`) : null),
      inlineStats(view)),
    raceBar(progressCount, view.rounds));
}

function challenge(view) {
  const me = view.me;
  const ciphertext = me.challenge.ciphertext;
  const isEasy = view.difficulty === 'easy';

  const candidate = isEasy ? h('output', { id: 'candidate', className: 'candidate', 'aria-label': 'Candidate plaintext' }, decrypt(ciphertext, shift)) : null;
  const mapping = isEasy ? h('div', { className: 'alphabet-mapping', id: 'mapping', 'aria-label': 'Plaintext to ciphertext alphabet mapping' }) : null;
  const syncMapping = (value) => {
    if (!mapping) return;
    mapping.replaceChildren(...Array.from({ length: 26 }, (_, i) => h('span', {}, h('strong', {}, String.fromCharCode(65 + i)), h('span', {}, String.fromCharCode(65 + (i + value) % 26)))));
  };
  syncMapping(shift);

  const wheel = cipherWheel({
    shift,
    isEasy,
    onChange: (next) => {
      shift = next;
      persistDraft();
      if (candidate) candidate.textContent = decrypt(ciphertext, shift);
      syncMapping(shift);
    },
  });

  const form = h('form', { id: 'answer-form', onSubmit: (event) => { event.preventDefault(); gameAction('answer', { answer: draft }); } },
    h('label', { className: 'sr-only', for: 'answer' }, 'Your plaintext answer'),
    h('textarea', {
      id: 'answer',
      name: 'answer',
      rows: 2,
      maxlength: 480,
      required: true,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'send',
      placeholder: 'Type the decoded message…',
      'aria-describedby': 'answer-help',
      onInput: (event) => { draft = event.target.value; persistDraft(); },
      onKeydown: (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          form.requestSubmit();
        }
      },
    }, draft),
    h('button', { id: 'check-answer', type: 'submit', className: 'button primary bp-btn--block', 'data-action': '' }, 'Check answer'),
    h('p', { id: 'answer-help', className: 'hint play-hint' }, 'Case & extra spaces ignored; keep punctuation.'));

  const centerStage = h('div', { className: 'play-center' },
    h('div', { className: 'ciphertext-card' },
      h('span', { className: 'field-micro', id: 'cipher-label' }, 'Ciphertext'),
      h('div', { className: 'ciphertext', 'aria-labelledby': 'cipher-label' }, ciphertext)),
    isEasy
      ? h('div', { className: 'candidate-inline' },
        h('div', { className: 'candidate-body' },
          h('span', { className: 'field-micro' }, 'Live preview'),
          candidate),
        button('Use this candidate', () => { draft = candidate.textContent; persistDraft(); const answer = document.querySelector('#answer'); answer.value = draft; answer.focus(); }, { className: 'button secondary small' }))
      : null,
    form,
    h('p', { id: 'answer-feedback', className: 'feedback', role: 'status', 'aria-live': 'polite' }));

  const utilities = h('div', { className: 'play-utilities' },
    h('details', { id: 'hints-details', className: 'play-disclosure', open: me.round.hints > 0 },
      h('summary', {}, `Hints · ${me.round.hints}/3 revealed`),
      h('p', { className: 'hint' }, 'Each new hint costs 10 points this round. Reading an unlocked hint again is free.'),
      ...(me.unlockedHints || []).map((text, i) => h('p', { className: 'hint-card' }, h('strong', {}, `Hint ${i + 1}. `), text)),
      me.round.hints < 3 ? button(`Reveal hint ${me.round.hints + 1} (−10 points)`, () => gameAction('hint', { hintNumber: me.round.hints + 1 }), { className: 'button secondary small', 'data-action': '' }) : null),
    isEasy
      ? h('details', { id: 'mapping-details', className: 'play-disclosure' },
        h('summary', {}, 'Alphabet table'),
        h('p', { className: 'hint' }, 'Top: plain letter. Bottom: cipher letter.'),
        mapping)
      : null,
    route === 'room'
      ? h('details', { id: 'live-progress', className: 'play-disclosure' },
        h('summary', {}, 'Live race'),
        dashboard(view),
        hostControls(view))
      : null);

  return h('div', { className: 'play-stage' },
    playHud(view, `Message ${me.roundIndex + 1} of ${view.rounds}`, me.roundIndex),
    centerStage,
    h('div', { className: 'play-wheel-stage' }, wheel.element),
    utilities);
}

function checkIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L3.22 8.28a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z');
  svg.append(path);
  return svg;
}

function solved(view) {
  const last = view.me.history.at(-1);
  return h('div', { className: 'play-stage play-stage--solved' },
    playHud(view, 'Message unlocked', view.me.completed),
    h('section', { className: 'narrow-card solved-card' },
      h('span', { className: 'badge solved-card__badge' }, checkIcon(), 'MESSAGE UNLOCKED'),
      h('p', { className: 'solved-text' }, last.plaintext),
      h('div', { className: 'round-score' }, `+${last.score}`, h('span', {}, ' points')),
      h('p', { className: 'hint' }, `Shift ${last.key} · ${last.attempts === 1 ? '1 try' : `${last.attempts} tries`} · ${last.hints === 1 ? '1 hint' : `${last.hints} hints`}`),
      button('Next Round', () => gameAction('next'), { className: 'button primary bp-btn--block', 'data-action': '' })),
    route === 'room'
      ? h('div', { className: 'play-utilities' },
        h('details', { id: 'live-progress', className: 'play-disclosure' },
          h('summary', {}, 'Live race'),
          dashboard(view),
          hostControls(view)))
      : null);
}

function countdown(view) {
  return h('section', { className: 'narrow-card status-panel countdown' },
    icon('hourglass', 'outcome-icon outcome-icon--sm'),
    badge('THE SAME START FOR EVERYONE'),
    h('h1', {}, 'Get your curiosity ready.'),
    h('p', { id: 'countdown-number', className: 'countdown-number', 'aria-hidden': 'true' }, Math.max(1, Math.ceil((view.startsAt - Date.now() - (route === 'room' ? offset : 0)) / 1000))),
    h('p', { role: 'status', className: 'hint' }, 'The race starts in three seconds.'),
    hostControls(view));
}

function results(view) {
  const winner = view.members.find((m) => m.id === view.winnerId);
  const won = route === 'solo' || winner?.id === view.me?.id;
  return h('div', { className: 'results-stage' },
    h('section', { className: `narrow-card result-hero${won ? ' result-hero--won' : ''}` },
      icon('crown', 'outcome-icon outcome-icon--sm'),
      badge(route === 'solo' ? 'LOCAL RESULT — NON-AUTHORITATIVE' : 'RACE COMPLETE'),
      h('h1', {}, route === 'solo' ? 'Curiosity looks good on you.' : winner?.id === view.me?.id ? 'You found the finish.' : `${winner?.name || 'A player'} wins the race!`),
      view.me?.participates ? inlineStats(view) : null,
      h('div', { className: 'result-actions button-row' },
        route === 'solo' ? button('New game', () => task(async () => { solo = soloEngine.createSolo(view.difficulty, view.rounds, solo.sequence); draft = ''; shift = 0; renderedKey = ''; }), { className: 'button primary' }) : hostControls(view),
        route === 'solo' ? button('Change settings', () => navigate('solo-setup'), { className: 'button secondary' }) : null,
        button('Home', () => navigate('home'), { className: 'button secondary' }),
        route === 'room' && !view.me?.host ? h('p', { className: 'hint' }, 'Waiting for host rematch.') : null)),
    route === 'room' ? dashboard(view, true) : null,
    view.me?.history?.length
      ? h('details', { className: 'play-disclosure', id: 'history' },
        h('summary', {}, 'Review your solved messages'),
        ...view.me.history.map((entry) => h('p', { className: 'history-row' }, `${entry.roundIndex + 1}. ${entry.plaintext} · ${entry.score} pts · shift ${entry.key}`)))
      : null,
    h('p', { className: 'hint recap-note' }, 'With only 26 possible shifts, Caesar shows why small key spaces fail fast.'));
}

function terminal(view) {
  const closed = view?.status === 'closed';
  return h('section', { className: 'narrow-card status-panel' },
    icon('hourglass', 'outcome-icon outcome-icon--sm'),
    badge(closed ? 'ROOM CLOSED' : 'RACE CANCELLED'),
    h('h1', {}, closed ? 'Thanks for playing.' : 'A pause in the proceedings.'),
    h('p', { className: 'hint' }, closed ? 'The host has closed this room.' : 'Progress is frozen without a winner. The host can prepare a rematch.'),
    h('div', { className: 'button-row' },
      !closed ? hostControls(view) : null,
      closed ? button('Return home', () => { client.clear(); room = null; navigate('home', { force: true }); }, { className: 'button primary' }) : null,
      button('Play Solo', () => navigate('solo-setup'), { className: 'button secondary' })));
}

function roomScreen(view) {
  if (route === 'room' && roomProblem) {
    const expired = roomProblem === 'ROOM_EXPIRED' || (client.session?.expiresAt && client.session.expiresAt <= Date.now() + offset);
    return h('section', { className: 'narrow-card status-panel' },
      icon('hourglass', 'outcome-icon outcome-icon--sm'),
      badge(expired ? 'ROOM EXPIRED' : roomProblem === 'INVALID_SESSION' ? 'SESSION UNAVAILABLE' : 'ROOM UNAVAILABLE'),
      h('h1', {}, expired ? 'A fresh start awaits.' : 'Room unavailable.'),
      h('p', { className: 'hint' }, expired ? 'Rooms last 24 hours. Ask your host for a new code.' : messages[roomProblem]),
      button('Return home', () => { client.clear(); room = null; roomProblem = ''; navigate('home', { force: true }); }, { className: 'button primary' }));
  }
  if (!view) {
    return h('section', { className: 'narrow-card status-panel' },
      icon('hourglass', 'outcome-icon outcome-icon--sm'),
      h('h1', {}, route === 'solo' ? 'Loading your solo game…' : 'Recovering your room…'),
      h('p', { className: 'hint' }, route === 'solo' ? 'Restoring the game saved in this tab.' : 'Reconnecting using the session saved in this tab.'),
      button(route === 'solo' ? 'Retry recovery' : 'Retry connection', () => route === 'solo' ? startSoloRecovery() : recoverRoom(), { className: 'button primary' }));
  }
  if (view.status === 'lobby') return lobby(view);
  if (view.status === 'countdown') return countdown(view);
  if (view.status === 'finished') return results(view);
  if (['cancelled', 'closed'].includes(view.status)) return terminal(view);
  if (view.me?.participates) {
    return h('div', { className: 'play-screen' }, view.me.phase === 'solved' ? solved(view) : challenge(view));
  }
  return h('div', { className: 'host-stage' },
    h('div', { className: 'host-stage__head' },
      h('div', {},
        badge(`ROOM ${view.code}`),
        h('h1', {}, 'Watch discovery happen.')),
      h('div', { className: 'host-stage__meta' },
        h('span', { className: 'badge' }, view.difficulty === 'hard' ? 'Hard' : 'Easy'),
        h('span', { className: 'badge' }, `${view.rounds} rounds`)),
      hostControls(view)),
    dashboard(view));
}

function render(force = false) {
  if (suspended) return;
  const view = currentView();
  if (['room', 'solo'].includes(route) && view?.me) {
    const identity = `${route}:${draftIdentity(view)}`;
    if (draftKey !== identity) { draftKey = identity; ({ draft, shift } = loadDraft(route, identity)); }
  }
  const key = `${route}:${roomProblem}:${view?.code}:${view?.raceId}:${view?.status}:${view?.me?.roundIndex}:${view?.me?.phase}:${view?.me?.round?.hints}`;
  if (!force && key === renderedKey && ['room', 'solo'].includes(route)) { refreshDynamic(view); updateNotice(); updateDisabled(); return; }
  const activeId = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  const formValues = new Map([...document.querySelectorAll('form input[id]')].map((node) => [node.id, { value: node.value, checked: node.checked }]));
  const opened = new Set([...document.querySelectorAll('details[open][id]')].map((n) => n.id));
  renderedKey = key; uiGeneration++;
  const minimal = ['solo', 'room'].includes(route) && !roomProblem && view?.status === 'racing' && Boolean(view.me?.participates);
  const content = route === 'home' ? landing() : route === 'solo-setup' ? setup(false) : route === 'create' ? setup(true) : route === 'join' ? joinScreen() : roomScreen(view);
  shell(content, { minimal });
  for (const [id, saved] of formValues) { const node = document.getElementById(id); if (node && !['solo', 'room'].includes(route)) { node.value = saved.value; node.checked = saved.checked; } }
  for (const id of opened) { const node = document.getElementById(id); if (node?.tagName === 'DETAILS') node.open = true; }
  const focus = activeId && document.getElementById(activeId);
  if (focus) { focus.focus({ preventScroll: true }); if (typeof selection === 'number' && focus.setSelectionRange && focus.type !== 'number' && focus.type !== 'range') focus.setSelectionRange(selection, selection); }
  updateDisabled(); refreshDynamic(view);
}

function refreshDynamic(view) {
  if (!view) return;
  for (const node of document.querySelectorAll('[data-occupancy]')) node.textContent = `${view.occupancy ?? 1}/30 players`;
  for (const node of document.querySelectorAll('[data-invite-empty]')) node.hidden = view.occupancy > 0;
  const list = document.querySelector('#progress-list'); if (list) fillProgress(list, view, view.status === 'finished');
  if (view.me) for (const [id, value] of [['round-stat', `${view.me.completed}/${view.rounds}`], ['points-stat', view.me.points], ['attempts-stat', view.me.attempts], ['hints-stat', view.me.hints]]) { const node = document.getElementById(id); if (node) node.textContent = value; }
}

async function multiplayerAction(action, extra = {}) {
  await task(async () => { const result = await client.mutate(action, room, extra); acceptRoom(result.room); if (result.outcome?.correct === false) wrongFeedback(); });
}
function wrongFeedback() { const node = document.querySelector('#answer-feedback'); if (node) node.textContent = 'Not quite yet. Try another shift and check the punctuation.'; }
async function gameAction(action, extra = {}) {
  const view = currentView();
  const scope = route;
  const identity = `${scope}:${draftIdentity(view)}`;
  await task(async () => {
    const result = scope === 'solo' ? { outcome: soloEngine.actSolo(solo, action, extra) } : await client.mutate(action, view, { roundIndex: view.me.roundIndex, ...extra });
    if (result.room) acceptRoom(result.room);
    if (result.outcome?.correct) { saveDraft(scope, identity, '', 0); if (draftKey === identity) draft = ''; announce('Correct! Your message is unlocked.'); }
    if (result.outcome?.text) announce(result.outcome.text);
    if (result.outcome?.correct === false) wrongFeedback();
  });
}
async function startSoloRecovery() {
  if (busy) return;
  navigate('solo', { force: true });
  await task(async () => {
    soloEngine = await import('./solo/game.js'); solo = soloEngine.loadSolo();
    if (!solo) { storage.remove(SOLO_SESSION); if (route === 'solo') navigate('solo-setup', { force: true }); }
  });
}
async function recoverRoom() {
  if (busy) return;
  if (!client.session) { navigate('join', { force: true }); return; }
  navigate('room', { force: true });
  await task(async () => { const data = await client.recover(); acceptRoom(data.room); if (data.outcome?.left) { client.clear(); room = null; navigate('home', { force: true, historyMode: 'replace' }); } else if (data.outcome?.correct === false) wrongFeedback(); });
  schedulePoll();
}
function schedulePoll(ms = 2000) { clearTimeout(pollTimer); if (!suspended && route === 'room' && client.session && !document.hidden) pollTimer = setTimeout(poll, ms); }
async function poll() {
  if (suspended || document.hidden || route !== 'room' || !client.session) return;
  if (busy || polling) { schedulePoll(); return; }
  polling = true;
  const session = client.session;
  try {
    const data = client.session.pending || client.session.bootstrap ? await client.recover() : await client.status();
    if (suspended || route !== 'room' || client.session !== session) return;
    if (data.outcome?.left) { client.clear(); room = null; navigate('home', { force: true }); return; }
    acceptRoom(data.room); failures = 0; sync = 'online'; error = ''; render();
    if (data.outcome?.correct === false) wrongFeedback();
  } catch (err) { if (suspended || route !== 'room' || client.session !== session || err.code === 'SESSION_CHANGED') return; failures++; sync = failures > 1 ? 'offline' : 'reconnecting'; setError(err); if (roomProblem) render(); }
  finally { polling = false; }
  schedulePoll(Math.min(15000, 2000 * 2 ** failures));
}
document.addEventListener('visibilitychange', () => { clearTimeout(pollTimer); if (!document.hidden) { schedulePoll(0); tick(); } });
window.addEventListener('online', () => schedulePoll(0));
window.addEventListener('hashchange', () => { const next = location.hash.slice(1) || 'home'; navigate(routes.includes(next) ? next : 'home', { historyMode: 'none' }); });
function tick() {
  if (suspended) return;
  const view = currentView();
  if (!view) return;
  const now = Date.now() + (route === 'room' ? offset : 0);
  const timer = document.querySelector('#elapsed'); if (timer) timer.textContent = formatTime((view.endedAt || now) - view.startsAt);
  const countdownNode = document.querySelector('#countdown-number'); if (countdownNode) countdownNode.textContent = Math.max(1, Math.ceil((view.startsAt - now) / 1000));
  if (view.status === 'countdown' && now >= view.startsAt) { if (route === 'solo') { renderedKey = ''; render(); announce('The race has started.'); } else if (!polling) schedulePoll(0); }
  if (route === 'solo' && solo && renderedKey.includes(':countdown:') && view.status === 'racing') { render(); announce('The race has started.'); }
}
let clock = setInterval(tick, 250);
window.addEventListener('pagehide', () => { suspended = true; persistDraft(); client.dispose(); clearTimeout(pollTimer); clearInterval(clock); });
window.addEventListener('pageshow', (event) => { suspended = false; if (event.persisted) { clearInterval(clock); clock = setInterval(tick, 250); tick(); render(); schedulePoll(0); } });
const invitationCode = new URLSearchParams(location.search).get('join');
if (invitationCode !== null) {
  const sameRoom = client.session?.code && client.session.code.replace(/\s/g, '').toUpperCase() === invitationCode.replace(/\s/g, '').toUpperCase();
  route = sameRoom ? 'room' : 'join';
  if (sameRoom) history.replaceState(null, '', `${location.pathname}#room`);
}
if (!routes.includes(route)) route = 'home';
render();
if (route === 'solo') startSoloRecovery();
if (route === 'room' || client.session?.bootstrap && ['create', 'join'].includes(route)) recoverRoom();
