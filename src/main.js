import './styles/app.css';
import { h, button, badge, dialog } from './ui/dom.js';
import { icon, intro, shiftIllustration } from './ui/visual.js';
import { decrypt } from './core/rules.js';
import { RoomClient } from './transport/api.js';
import { storage, SOLO_SESSION } from './transport/session.js';

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
  PLAYER_REQUIRED: 'At least one player is needed to start.', REQUEST_CONFLICT: 'This request conflicts with an earlier request. Refresh to recover your session.',
  HOST_ONLY: 'Only the host can use this control.', ROOM_VERSION_UNSUPPORTED: 'This room uses an unsupported version. Please create a new room.',
  SECURE_CONTEXT_REQUIRED: 'Open the game over HTTPS, or use localhost on this computer, to create a secure session.'
};
const formatTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const currentView = () => route === 'solo' && solo ? soloEngine.soloView(solo) : room;
const isActive = () => (route === 'solo' && solo && !solo.endedAt) || (route === 'room' && room && !roomProblem && !['closed'].includes(room.status));

function announce(text) { announcements.textContent = text; }
function setError(err) {
  if (err.code === 'SESSION_CHANGED') return;
  error = messages[err.code || err.message] || 'Something went wrong. Please retry.';
  if (route === 'room' && ['INVALID_SESSION', 'ROOM_UNAVAILABLE', 'ROOM_EXPIRED', 'ROOM_VERSION_UNSUPPORTED'].includes(err.code)) roomProblem = err.code;
  if (err.retryAfter) error += ` Try again in ${err.retryAfter} seconds.`;
  updateNotice();
}
function updateNotice() {
  const node = document.querySelector('#notice'); if (!node) return;
  node.replaceChildren(); node.hidden = !error && sync === 'online';
  if (error) node.append(h('p', {}, error));
  if (sync !== 'online') node.append(h('p', {}, sync === 'reconnecting' ? 'Reconnecting… your progress is saved on the server.' : 'Connection unavailable. Your answer has been preserved.'));
  if (client.session && (client.session.bootstrap || client.session.pending || route === 'room' && (error || sync !== 'online'))) node.append(button('Retry connection', () => recoverRoom(), { className: 'button small' }));
}
function acceptRoom(next) {
  if (room && room.code === next.code && next.roomVersion < room.roomVersion) return;
  const old = room;
  if (!old || old.raceId !== next.raceId || old.me?.roundIndex !== next.me?.roundIndex) { draft = ''; shift = 0; }
  room = next; offset = client.offset; roomProblem = '';
  if (old && old.status !== 'finished' && next.status === 'finished') announce('The race has finished. Final standings are ready.');
}
async function task(work) {
  if (busy) return;
  busy = true; error = ''; updateNotice(); updateDisabled();
  try { await work(); }
  catch (err) { setError(err); }
  finally { busy = false; render(); updateDisabled(); }
}
function updateDisabled() {
  for (const control of document.querySelectorAll('[data-action]')) control.disabled = busy || (route === 'room' && Boolean(client.session?.pending)) || (control.hasAttribute('data-needs-player') && !room?.occupancy);
}
function navigate(next, { force = false } = {}) {
  if (busy && !force) return;
  if (next === route && !force) return;
  if (!force && isActive() && next !== route) {
    dialog(route === 'room' ? room.me?.host ? 'Close this room?' : 'Leave this room?' : 'Leave your solo game?', h('p', {}, route === 'room' ? room.me?.host ? 'Closing ends the room for everyone. A network disconnect would keep it running.' : 'Leaving releases your membership. You cannot rejoin after the countdown begins.' : 'Your solo game stays saved in this tab. You can resume it from the home screen.'), { confirmText: route === 'room' ? room.me?.host ? 'Close room' : 'Leave room' : 'Leave game', confirm: () => task(async () => {
      if (route === 'room') { await client.mutate('leave', room); client.clear(); room = null; }
      navigate(next, { force: true });
    }) });
    return;
  }
  route = next; error = ''; sync = 'online'; renderedKey = ''; history.pushState(null, '', `#${next}`); render(); schedulePoll(0);
}
function showRules() {
  dialog('How to play', h('div', { className: 'prose' },
    h('p', {}, 'A Caesar cipher moves every letter by the same number of places. With encryption shift 3, A becomes D and Z becomes C. To decrypt, move backward.'),
    h('p', {}, 'Read the ciphertext, experiment, and enter the original message. Case and extra whitespace do not matter; punctuation does. Empty or malformed answers cost nothing.'),
    h('p', {}, 'Easy has a live shift tool. Hard has a static alphabet. Each new hint costs 10 points; each wrong answer costs 2. A solved round earns at least 20 points.'),
    h('p', {}, 'Press Next Round after each solved message. In multiplayer, everyone receives the same messages and moves independently. The first final answer accepted by the server wins, regardless of points.'),
    h('h3', {}, 'A lesson in small secrets'),
    h('p', {}, 'There are only 26 possible shifts, including the unchanged alphabet. This game uses the 25 nonzero keys. Trying every shift is easy, and language patterns remain visible. A large key space alone does not guarantee security: the design must also resist attacks.'),
    h('p', {}, 'Server-authoritative scoring protects recorded results. Caesar is intentionally easy to solve with external tools; this is a learning game, not comprehensive anti-cheat protection.')));
}
function shell(content) {
  const main = h('main', { id: 'main', tabindex: '-1' }, h('div', { id: 'notice', className: 'notice', role: 'alert', hidden: true }), content);
  app.replaceChildren(h('header', { className: 'topbar' }, h('div', { className: 'brand-group' }, button(h('img', { src: '/brand/bitpolito-logo-blue.svg', alt: '', width: 172, height: 30 }), () => navigate('home'), { className: 'wordmark', 'aria-label': 'BitPolito home' }), h('span', { className: 'app-name' }, 'Caesar Race')), h('nav', { className: 'header-actions', 'aria-label': 'Main navigation' }, route !== 'home' ? button('Home', () => navigate('home'), { className: 'button quiet' }) : null, button('How to play', showRules, { className: 'button quiet' }))), main,
    h('footer', { className: 'footer' }, h('span', { className: 'footer-brand' }, icon('cow'), 'Made for curious minds.'), h('span', {}, 'A BitPolito workshop game · No accounts needed')));
  updateNotice();
}
function landing() {
  const resume = [];
  if (storage.get(SOLO_SESSION)) resume.push(button('Resume solo game', () => startSoloRecovery(), { className: 'button secondary' }));
  if (client.session) resume.push(button('Recover room session', () => recoverRoom(), { className: 'button secondary' }));
  return h('div', { className: 'landing' },
    h('section', { className: 'hero' }, h('div', { className: 'hero-copy' }, badge('THE BITPOLITO CIPHER CHALLENGE'), h('h1', {}, 'Caesar Race', h('span', { className: 'hero-tagline' }, 'Small shift. Big discovery.')), h('p', { className: 'lead' }, 'Crack a message, discover a pattern. Explore the Caesar cipher on your own or race your friends to the finish.'), h('div', { className: 'hero-notes' }, h('span', {}, 'Phone friendly'), h('span', {}, 'No accounts'), h('span', {}, 'Everyone welcome')))),
    h('section', { className: 'mode-grid', 'aria-label': 'Choose a game' },
      modeCard('crypto', 'At your own pace', 'Play Solo', 'Find your rhythm. Try a shift, spot a pattern, and uncover each message.', 'solo-setup', true),
      modeCard('share', 'Bring everyone together', 'Create Room', 'Host a workshop race. Share an invitation and watch the discoveries unfold.', 'create'),
      modeCard('key', 'An invitation to decode', 'Join Room', 'Have a room code? Pick your name and get ready for a shared challenge.', 'join')),
    resume.length ? h('div', { className: 'resume-row' }, ...resume) : null,
    shiftIllustration(),
    h('div', { className: 'learning-note' }, h('strong', {}, 'Old cipher. Fresh perspective.'), h('p', {}, 'Caesar is a starting point for understanding encryption, experimentation, and why a secret needs more than a clever disguise.')));
}
function modeCard(asset, label, title, description, target, primary = false) {
  return h('article', { className: `mode-card${primary ? ' featured' : ''}` }, h('div', { className: 'card-top' }, icon(asset, 'card-symbol'), h('span', { className: 'eyebrow' }, label)), h('h2', {}, title), h('p', {}, description), button(title, () => navigate(target), { className: `button ${primary ? 'primary' : 'secondary'}`, 'data-action': '' }));
}
function labelled(text, input, help) { return h('label', { className: 'field' }, h('span', { className: 'field-label' }, text), input, help ? h('span', { className: 'hint' }, help) : null); }
function setup(isRoom) {
  const difficulty = h('fieldset', { className: 'difficulty-picker' }, h('legend', {}, 'Difficulty'), ...['easy', 'hard'].map((value) => h('label', { className: 'difficulty-option' }, h('input', { id: `difficulty-${value}`, type: 'radio', name: 'difficulty', value, checked: value === 'easy' }), h('span', {}, h('strong', {}, value === 'easy' ? 'Easy' : 'Hard'), h('small', {}, value === 'easy' ? 'Explore with a live shift tool' : 'Decode with an alphabet reference')))));
  const form = h('form', { className: 'setup-form', onSubmit: (event) => { event.preventDefault(); const data = new FormData(form); task(async () => {
    if (isRoom) {
      if (client.session?.bootstrap || client.session?.pending) throw new Error('PENDING_REQUEST');
      const result = await client.bootstrap('create', { name: data.get('name'), difficulty: data.get('difficulty'), rounds: Number(data.get('rounds')), participates: data.has('participates') });
      acceptRoom(result.room); navigate('room', { force: true });
    } else { soloEngine = await import('./solo/game.js'); solo = soloEngine.createSolo(data.get('difficulty'), Number(data.get('rounds'))); draft = ''; shift = 0; navigate('solo', { force: true }); }
  }); } },
  isRoom ? labelled('Host name', h('input', { name: 'name', id: 'host-name', required: true, maxlength: 48, autocomplete: 'nickname', placeholder: 'How should we call you?' })) : null,
  difficulty,
  labelled('Rounds to complete', h('input', { name: 'rounds', id: 'rounds', type: 'number', min: 1, max: 10, step: 1, value: 3, required: true }), 'Choose 1–10 rounds. Each round is a new message.'),
  isRoom ? h('label', { className: 'check-field' }, h('input', { id: 'participates', type: 'checkbox', name: 'participates' }), h('span', {}, 'Participate as a player', h('small', {}, 'Leave unchecked to host from the spectator dashboard.'))) : null,
  h('button', { className: 'button primary', type: 'submit', 'data-action': '' }, isRoom ? 'Create room' : 'Start solo game'));
  return h('section', { className: 'setup-layout' }, intro(isRoom ? 'HOST A WORKSHOP' : 'YOUR OWN PACE', isRoom ? 'Make room for discovery.' : 'Set your challenge.', isRoom ? 'Up to 30 players. One shared sequence. A finish line everyone can reach.' : 'Start with a helping hand, or let your reasoning do the work.', isRoom ? 'share' : 'crypto', isRoom ? 'Spectate by default, or join the race yourself.' : 'One message at a time. All the time you need.'), h('div', { className: 'panel form-panel' }, h('h2', {}, 'Game settings'), form));
}
function joinScreen() {
  const invite = new URLSearchParams(location.search).get('join') || '';
  const code = h('input', { id: 'room-code', name: 'code', required: true, maxlength: 12, value: preview?.code || invite, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'ABC234' });
  const previewBox = h('div', { id: 'room-preview', className: 'preview-box', role: 'status' });
  const showPreview = () => { if (preview) previewBox.replaceChildren(h('strong', {}, `${preview.difficulty === 'easy' ? 'Easy' : 'Hard'} · ${preview.rounds} rounds`), h('p', {}, `${preview.occupancy}/30 players · ${preview.status === 'lobby' ? 'Open for joining' : 'Joining has closed'}`)); };
  const form = h('form', { onSubmit: (event) => { event.preventDefault(); task(async () => {
    if (client.session?.bootstrap || client.session?.pending) throw new Error('PENDING_REQUEST');
    const data = new FormData(form); const result = await client.bootstrap('join', { code: data.get('code'), name: data.get('name') });
    acceptRoom(result.room); history.replaceState(null, '', `${location.pathname}#room`); navigate('room', { force: true });
  }); } }, labelled('Room code', code), button('Check room', () => task(async () => { const data = await client.request('preview', { code: code.value }, null); preview = data.room; showPreview(); }), { className: 'button secondary', 'data-action': '' }), previewBox, labelled('Player name', h('input', { id: 'player-name', name: 'name', required: true, maxlength: 48, autocomplete: 'nickname', placeholder: 'Your name for this race' })), h('button', { type: 'submit', className: 'button primary', 'data-action': '' }, 'Join room'));
  showPreview();
  return h('section', { className: 'setup-layout' }, intro('A SHARED CHALLENGE', 'You’re in good company.', 'Enter the code from your host. No account, no installation. Just your curiosity.', 'key', 'Your invitation is a six-character room code.'), h('div', { className: 'panel form-panel' }, h('h2', {}, 'Your invitation'), form));
}
function connection(member) { const age = member.lastSeen ? Date.now() + offset - member.lastSeen : Infinity; return member.left ? 'Left' : age <= 15000 ? 'Connected recently' : age <= 60000 ? 'Inactive' : 'Disconnected or tab hidden'; }
function dashboard(view, final = false) {
  const list = h('ol', { className: 'standings', id: 'progress-list', 'aria-label': final ? 'Final standings' : 'Live progress' });
  fillProgress(list, view, final);
  return h('section', { className: 'panel dashboard' }, h('div', { className: 'section-head' }, h('div', {}, h('p', { className: 'eyebrow' }, final ? 'THE FINISH LINE' : 'SHARED CHALLENGE'), h('h2', {}, final ? 'Final standings' : 'The race, at a glance')), h('span', { className: 'badge', 'data-occupancy': '' }, `${view.occupancy ?? 1}/30 players`)), list);
}
function fillProgress(list, view, final = false) {
  const players = view.standings || [];
  list.replaceChildren(...(players.length ? players.map((m, i) => h('li', { className: `progress-row${m.id === view.winnerId ? ' winner' : ''}` }, h('span', { className: 'rank' }, i + 1), h('div', { className: 'player-body' }, h('strong', {}, m.name, m.id === view.me?.id ? ' (you)' : ''), h('progress', { max: view.rounds, value: m.completed, 'aria-label': `${m.name}: ${m.completed} of ${view.rounds} rounds` }), h('small', {}, m.left ? 'Left' : final && m.id !== view.winnerId ? 'Did not finish' : connection(m)), m.latestCorrectAt ? h('small', { className: 'player-activity' }, `Latest solve: ${formatTime(m.latestCorrectAt - view.startsAt)} into race`) : null), h('div', { className: 'player-score' }, h('strong', {}, `${m.completed}/${view.rounds}`), h('small', {}, `${m.points} points`)))) : [h('li', { className: 'empty-state' }, 'No players yet. Share your invitation to get started.')]));
}
function hostControls(view) {
  if (!view.me?.host) return null;
  return h('div', { className: 'host-controls' },
    view.status === 'lobby' ? button('Start race', () => multiplayerAction('start'), { className: 'button primary', 'data-action': '', 'data-needs-player': '', disabled: view.occupancy < 1 || busy }) : null,
    ['finished', 'cancelled'].includes(view.status) ? button('Prepare rematch', () => multiplayerAction('reset'), { className: 'button primary', 'data-action': '' }) : null,
    ['lobby', 'countdown', 'racing'].includes(view.status) ? button('Cancel race', () => dialog('Cancel this race?', h('p', {}, 'Progress will be frozen without a winner. You can prepare a rematch with the same members.'), { confirmText: 'Cancel race', confirm: () => multiplayerAction('cancel') }), { className: 'button danger', 'data-action': '' }) : null);
}
function invitation(view) {
  const url = `${location.origin}/?join=${view.code}`;
  const fallback = h('div', { className: 'copy-fallback' });
  async function copy(value) { try { await navigator.clipboard.writeText(value); announce('Copied to clipboard.'); fallback.replaceChildren(h('p', { role: 'status' }, 'Copied to clipboard.')); } catch { fallback.replaceChildren(labelled('Select and copy', h('input', { readonly: true, value, onFocus: (e) => e.target.select() }))); } }
  const qr = h('div', { className: 'qr-placeholder', 'aria-label': 'Invitation QR code' }, 'Preparing QR…');
  const generation = uiGeneration;
  import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 400, margin: 2, errorCorrectionLevel: 'M' })).then((src) => {
    if (generation !== uiGeneration) return;
    const image = h('img', { src, alt: 'Scan to open the room invitation', width: 160, height: 160 });
    qr.replaceChildren(button('', () => dialog('Scan to join', h('div', { className: 'qr-dialog' }, h('img', { src, alt: `Invitation for room ${view.code}`, width: 400, height: 400 }), h('p', {}, view.code))), { className: 'qr-button', 'aria-label': 'Enlarge invitation QR code' })); qr.firstChild.append(image);
  }).catch(() => qr.replaceChildren(h('p', {}, 'Use the room code or link to join.')));
  return h('section', { className: 'panel invite-panel' }, h('div', {}, h('div', { className: 'invite-heading' }, icon('share'), h('span', { className: 'eyebrow' }, 'YOUR ROOM CODE')), h('div', { className: 'room-code' }, view.code), h('div', { className: 'button-row' }, button('Copy code', () => copy(view.code), { className: 'button secondary small' }), button('Copy link', () => copy(url), { className: 'button secondary small' })), h('details', {}, h('summary', {}, 'Show invitation link'), h('a', { href: url, className: 'invite-link' }, url)), fallback), h('div', { className: 'qr-wrap' }, qr, h('p', { className: 'hint' }, 'Scan. Join. Decode.')));
}
function lobby(view) {
  return h('div', {}, h('div', { className: 'page-title' }, badge(view.me?.host ? 'YOU ARE THE HOST' : 'YOU’RE ON THE LIST'), h('h1', {}, 'A little anticipation.'), h('p', { className: 'lead' }, 'Everyone gets the same messages. Each player finds their own way through.')), h('div', { className: 'lobby-grid' }, invitation(view), h('section', { className: 'panel settings-panel' }, h('p', { className: 'eyebrow' }, 'THE PLAN'), h('h2', {}, 'Ready when you are.'), h('p', {}, `${view.difficulty === 'easy' ? 'Easy' : 'Hard'} · ${view.rounds} rounds · `, h('span', { 'data-occupancy': '' }, `${view.occupancy}/30 players`)), h('p', {}, `Host: ${view.members.find((m) => m.host)?.name || 'Host'}`), hostControls(view), !view.me?.host ? h('p', { className: 'hint' }, 'Waiting for the host to start the shared countdown.') : h('p', { className: 'hint' }, 'Starting closes joining. Disconnected players keep their place.'), h('p', { className: 'hint', 'data-invite-empty': '', hidden: view.occupancy > 0 }, 'Invite at least one player to start.'))), dashboard(view));
}
function stats(view) {
  const me = view.me;
  return h('div', { className: 'stats', 'aria-label': 'Your race statistics' }, ...[['round-stat', `${me.completed}/${view.rounds}`, 'completed'], ['points-stat', me.points, 'points'], ['attempts-stat', me.attempts, 'attempts'], ['hints-stat', me.hints, 'hints'], ['elapsed', formatTime((view.endedAt || Date.now() + (route === 'room' ? offset : 0)) - view.startsAt), 'elapsed']].map(([id, value, label]) => h('div', {}, h('strong', { id }, value), h('span', {}, label))));
}
function tools(ciphertext) {
  const candidate = h('output', { id: 'candidate', className: 'candidate', 'aria-label': 'Candidate plaintext' }, decrypt(ciphertext, shift));
  const mapping = h('div', { className: 'alphabet-mapping', id: 'mapping', 'aria-label': 'Plaintext to ciphertext alphabet mapping' });
  const slider = h('input', { type: 'range', id: 'shift', min: 0, max: 25, value: shift, 'aria-label': 'Encryption shift' });
  const shiftLabel = h('output', { id: 'shift-value', for: 'shift' }, shift);
  const update = (value) => { shift = Math.max(0, Math.min(25, Number(value))); slider.value = shift; shiftLabel.textContent = shift; candidate.textContent = decrypt(ciphertext, shift); mapping.replaceChildren(...Array.from({ length: 26 }, (_, i) => h('span', {}, h('strong', {}, String.fromCharCode(65 + i)), h('span', {}, String.fromCharCode(65 + (i + shift) % 26))))); };
  slider.addEventListener('input', () => update(slider.value)); update(shift);
  return h('section', { className: 'tools' }, h('div', { className: 'section-head' }, h('h3', {}, 'Try a shift'), h('span', {}, 'Encryption shift: ', shiftLabel)), h('div', { className: 'slider-row' }, button('−', () => update(shift - 1), { className: 'button stepper', 'aria-label': 'Decrease shift' }), slider, button('+', () => update(shift + 1), { className: 'button stepper', 'aria-label': 'Increase shift' })), candidate, button('Use this candidate', () => { draft = candidate.textContent; const answer = document.querySelector('#answer'); answer.value = draft; answer.focus(); }, { className: 'button secondary small' }), h('details', { id: 'mapping-details' }, h('summary', {}, 'Explore the alphabet mapping'), h('p', { className: 'hint' }, 'Top: original letter. Bottom: encrypted letter.'), mapping));
}
function challenge(view) {
  const me = view.me;
  const form = h('form', { id: 'answer-form', onSubmit: (event) => { event.preventDefault(); gameAction('answer', { answer: draft }); } }, labelled('Your plaintext answer', h('textarea', { id: 'answer', name: 'answer', rows: 2, maxlength: 480, required: true, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'What does the message say?', 'aria-describedby': 'answer-help', onInput: (event) => { draft = event.target.value; } }, draft)), h('p', { id: 'answer-help', className: 'hint' }, 'Case and extra whitespace do not matter. Keep the punctuation.'), h('button', { id: 'check-answer', type: 'submit', className: 'button primary', 'data-action': '' }, 'Check answer'));
  return h('section', { className: 'panel challenge-panel' }, h('div', { className: 'section-head' }, badge(`MESSAGE ${me.roundIndex + 1} OF ${view.rounds}`), badge(view.difficulty === 'easy' ? 'EASY' : 'HARD')), h('h2', {}, 'What’s the message?'), h('p', { className: 'eyebrow ciphertext-label', id: 'cipher-label' }, 'CIPHERTEXT'), h('div', { className: 'ciphertext', 'aria-labelledby': 'cipher-label' }, me.challenge.ciphertext), form,
    h('p', { id: 'answer-feedback', className: 'feedback', role: 'status', 'aria-live': 'polite' }),
    view.difficulty === 'easy' ? tools(me.challenge.ciphertext) : h('details', { className: 'hard-reference', id: 'alphabet-reference', open: true }, h('summary', {}, 'Alphabet reference'), h('div', { className: 'alphabet-static' }, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => h('span', {}, c)))),
    h('details', { id: 'hints-details', className: 'hint-details', open: me.round.hints > 0 }, h('summary', {}, `Hints · ${me.round.hints}/3 revealed`), h('p', { className: 'hint' }, 'Each new hint costs 10 points this round. Reading an unlocked hint again is free.'), ...(me.unlockedHints || []).map((text, i) => h('p', { className: 'hint-card' }, h('strong', {}, `Hint ${i + 1}. `), text)), me.round.hints < 3 ? button(`Reveal hint ${me.round.hints + 1} (−10 points)`, () => gameAction('hint', { hintNumber: me.round.hints + 1 }), { className: 'button secondary', 'data-action': '' }) : null));
}
function solved(view) {
  const last = view.me.history.at(-1);
  return h('section', { className: 'panel solved-panel' }, h('div', { className: 'outcome-heading' }, icon('key'), badge('MESSAGE UNLOCKED')), h('h2', {}, 'That’s a good discovery.'), h('p', { className: 'solved-text' }, last.plaintext), h('p', {}, `Encryption shift ${last.key}. Moving each encrypted letter backward by ${last.key} reveals the message.`), h('div', { className: 'round-score' }, `+${last.score}`, h('span', {}, ' points')), h('p', { className: 'hint' }, `${last.attempts} attempts · ${last.wrongAttempts} wrong · ${last.hints} hints`), button('Next Round', () => gameAction('next'), { className: 'button primary', 'data-action': '' }));
}
function countdown(view) {
  return h('section', { className: 'countdown panel' }, icon('hourglass', 'outcome-icon'), badge('THE SAME START FOR EVERYONE'), h('h1', {}, 'Get your curiosity ready.'), h('p', { id: 'countdown-number', className: 'countdown-number', 'aria-hidden': 'true' }, Math.max(1, Math.ceil((view.startsAt - Date.now() - (route === 'room' ? offset : 0)) / 1000))), h('p', { role: 'status' }, 'The race starts after a three-second countdown.'), hostControls(view));
}
function results(view) {
  const winner = view.members.find((m) => m.id === view.winnerId);
  return h('div', {}, h('section', { className: 'result-hero panel' }, icon('crown', 'outcome-icon'), badge(route === 'solo' ? 'LOCAL RESULT — NON-AUTHORITATIVE' : 'RACE COMPLETE'), h('h1', {}, route === 'solo' ? 'Curiosity looks good on you.' : winner?.id === view.me?.id ? 'You found the finish.' : `${winner?.name || 'A player'} wins the race!`), h('p', { className: 'lead' }, 'Every message solved is another idea understood.'), view.me?.participates ? stats(view) : null), route === 'room' ? dashboard(view, true) : null,
    h('div', { className: 'result-actions button-row' }, route === 'solo' ? button('New game', () => task(async () => { solo = soloEngine.createSolo(view.difficulty, view.rounds, solo.sequence); draft = ''; shift = 0; renderedKey = ''; }), { className: 'button primary' }) : hostControls(view), route === 'solo' ? button('Change settings', () => navigate('solo-setup'), { className: 'button secondary' }) : !view.me?.host ? h('p', { className: 'hint' }, 'Waiting for the host to prepare a rematch.') : null),
    h('section', { className: 'panel recap' }, h('div', {}, h('p', { className: 'eyebrow' }, 'TAKE AN IDEA WITH YOU'), h('h2', {}, 'What did we uncover?')), h('p', {}, 'Just 26 possible shifts, including identity, make Caesar easy to brute-force. A large key space alone does not guarantee security: the cipher must also withstand attacks and hide useful patterns.')),
    view.me?.history?.length ? h('details', { className: 'panel', id: 'history' }, h('summary', {}, 'Review your solved messages'), ...view.me.history.map((entry) => h('p', {}, `${entry.roundIndex + 1}. ${entry.plaintext} · ${entry.score} points · shift ${entry.key}`))) : null);
}
function terminal(view) {
  const closed = view?.status === 'closed';
  return h('section', { className: 'narrow panel status-panel' }, icon('hourglass', 'outcome-icon'), badge(closed ? 'ROOM CLOSED' : 'RACE CANCELLED'), h('h1', {}, closed ? 'Thanks for playing.' : 'A pause in the proceedings.'), h('p', {}, closed ? 'The host has closed this room. Start a new room or keep exploring solo.' : 'The race was cancelled without a winner. Progress is frozen. The host can prepare a rematch.'), !closed ? hostControls(view) : null, button('Play Solo', () => navigate('solo-setup'), { className: 'button secondary' }));
}
function roomScreen(view) {
  if (route === 'room' && roomProblem) {
    const expired = roomProblem === 'ROOM_EXPIRED' || (client.session?.expiresAt && client.session.expiresAt <= Date.now() + offset);
    return h('section', { className: 'narrow panel status-panel' }, icon('hourglass', 'outcome-icon'), badge(expired ? 'ROOM EXPIRED' : roomProblem === 'INVALID_SESSION' ? 'SESSION UNAVAILABLE' : 'ROOM UNAVAILABLE'), h('h1', {}, expired ? 'A fresh start awaits.' : 'Let’s find your next challenge.'), h('p', {}, expired ? 'Rooms last 24 hours from creation. Ask your host for a new invitation.' : messages[roomProblem]), button('Return home', () => { client.clear(); room = null; roomProblem = ''; navigate('home', { force: true }); }, { className: 'button primary' }));
  }
  if (!view) return h('section', { className: 'narrow panel status-panel' }, icon('hourglass', 'outcome-icon'), h('h1', {}, 'Recovering your room…'), h('p', {}, 'Reconnect using the session saved in this tab.'), button('Retry connection', () => recoverRoom()), button('Forget session', () => { client.clear(); room = null; navigate('home', { force: true }); }, { className: 'button quiet' }));
  if (view.status === 'lobby') return lobby(view);
  if (view.status === 'countdown') return countdown(view);
  if (view.status === 'finished') return results(view);
  if (['cancelled', 'closed'].includes(view.status)) return terminal(view);
  return h('div', {}, h('div', { className: 'race-heading' }, h('div', {}, badge(route === 'solo' ? 'SOLO EXPLORATION' : `ROOM ${view.code}`), h('h1', {}, view.me?.participates ? 'One message at a time.' : 'Watch discovery happen.')), route === 'room' ? badge('First to finish wins') : null),
    view.me?.participates ? h('div', { className: 'race-layout' }, h('div', {}, view.me.phase === 'solved' ? solved(view) : challenge(view)), h('aside', { className: 'race-aside' }, stats(view), h('div', { className: 'panel compact-panel' }, h('h2', {}, 'A little perspective'), h('p', {}, 'Keep experimenting. Spaces and punctuation stay put; letters wrap around the alphabet.'), button('Read the rules', showRules, { className: 'button quiet' })), route === 'room' ? h('details', { className: 'panel', id: 'live-progress' }, h('summary', {}, 'Live race progress'), dashboard(view), hostControls(view)) : null)) : h('div', { className: 'host-layout' }, h('section', { className: 'panel host-panel' }, h('div', {}, h('p', { className: 'eyebrow' }, `ROOM ${view.code}`), h('h2', {}, 'Host controls'), h('p', { className: 'hint' }, 'Host disconnected? The race continues. Refresh this tab to recover your controls.')), hostControls(view)), dashboard(view)));
}
function render(force = false) {
  const view = currentView();
  const key = `${route}:${roomProblem}:${view?.code}:${view?.raceId}:${view?.status}:${view?.me?.roundIndex}:${view?.me?.phase}:${view?.me?.round?.hints}`;
  if (!force && key === renderedKey && ['room', 'solo'].includes(route)) { refreshDynamic(view); updateNotice(); updateDisabled(); return; }
  const activeId = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  const formValues = new Map([...document.querySelectorAll('form input[id]')].map((node) => [node.id, { value: node.value, checked: node.checked }]));
  const opened = new Set([...document.querySelectorAll('details[open][id]')].map((n) => n.id));
  renderedKey = key; uiGeneration++;
  const content = route === 'home' ? landing() : route === 'solo-setup' ? setup(false) : route === 'create' ? setup(true) : route === 'join' ? joinScreen() : roomScreen(view);
  shell(content);
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
  await task(async () => {
    const result = route === 'solo' ? { outcome: soloEngine.actSolo(solo, action, extra) } : await client.mutate(action, view, { roundIndex: view.me.roundIndex, ...extra });
    if (result.room) acceptRoom(result.room);
    if (result.outcome?.correct) { draft = ''; announce('Correct! Your message is unlocked.'); }
    if (result.outcome?.text) announce(result.outcome.text);
    if (result.outcome?.correct === false) wrongFeedback();
  });
}
async function startSoloRecovery() { await task(async () => { soloEngine = await import('./solo/game.js'); solo = soloEngine.loadSolo(); if (!solo) { storage.remove(SOLO_SESSION); navigate('solo-setup', { force: true }); } else navigate('solo', { force: true }); }); }
async function recoverRoom() {
  await task(async () => { if (!client.session) { navigate('join', { force: true }); return; } const data = await client.recover(); acceptRoom(data.room); if (data.outcome?.left) { client.clear(); room = null; navigate('home', { force: true }); } else { navigate('room', { force: true }); if (data.outcome?.correct === false) wrongFeedback(); } });
  schedulePoll();
}
function schedulePoll(ms = 2000) { clearTimeout(pollTimer); if (route === 'room' && client.session && !document.hidden) pollTimer = setTimeout(poll, ms); }
async function poll() {
  if (document.hidden || route !== 'room' || !client.session) return;
  if (busy || polling) { schedulePoll(); return; }
  polling = true;
  try {
    const data = client.session.pending || client.session.bootstrap ? await client.recover() : await client.status();
    if (route !== 'room') return;
    if (data.outcome?.left) { client.clear(); room = null; navigate('home', { force: true }); return; }
    acceptRoom(data.room); failures = 0; sync = 'online'; error = ''; render();
    if (data.outcome?.correct === false) wrongFeedback();
  } catch (err) { failures++; sync = failures > 1 ? 'offline' : 'reconnecting'; setError(err); if (roomProblem) render(); }
  finally { polling = false; }
  schedulePoll(Math.min(15000, 2000 * 2 ** failures));
}
document.addEventListener('visibilitychange', () => { clearTimeout(pollTimer); if (!document.hidden) { schedulePoll(0); tick(); } });
window.addEventListener('online', () => schedulePoll(0));
window.addEventListener('hashchange', () => { const next = location.hash.slice(1) || 'home'; history.replaceState(null, '', `#${route}`); navigate(['home', 'solo-setup', 'create', 'join', 'solo', 'room'].includes(next) ? next : 'home'); });
window.addEventListener('beforeunload', (event) => { if (isActive()) { event.preventDefault(); event.returnValue = ''; } });
function tick() {
  const view = currentView();
  if (!view) return;
  const now = Date.now() + (route === 'room' ? offset : 0);
  const timer = document.querySelector('#elapsed'); if (timer) timer.textContent = formatTime((view.endedAt || now) - view.startsAt);
  const countdownNode = document.querySelector('#countdown-number'); if (countdownNode) countdownNode.textContent = Math.max(1, Math.ceil((view.startsAt - now) / 1000));
  if (view.status === 'countdown' && now >= view.startsAt) { if (route === 'solo') { renderedKey = ''; render(); announce('The race has started.'); } else if (!polling) schedulePoll(0); }
  if (route === 'solo' && solo && renderedKey.includes(':countdown:') && view.status === 'racing') { render(); announce('The race has started.'); }
}
let clock = setInterval(tick, 250);
window.addEventListener('pagehide', () => { client.dispose(); clearTimeout(pollTimer); clearInterval(clock); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { clearInterval(clock); clock = setInterval(tick, 250); schedulePoll(0); } });
if (new URLSearchParams(location.search).has('join')) route = 'join';
if (!['home', 'solo-setup', 'create', 'join', 'solo', 'room'].includes(route)) route = 'home';
render();
if (route === 'solo') startSoloRecovery();
if (route === 'room' || client.session?.bootstrap && ['create', 'join'].includes(route)) recoverRoom();
