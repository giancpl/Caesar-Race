import { h, button } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VW = 560;
const VH = 220;
const CX = 280;
const CY = 290;
const STEP = 360 / 26;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function triggerDetent() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(6);
  }
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

function mod26(value) {
  return ((Math.round(Number(value)) % 26) + 26) % 26;
}

function pointAt(index, radius) {
  const rad = ((index * STEP - 90) * Math.PI) / 180;
  return {
    x: Number((CX + radius * Math.cos(rad)).toFixed(2)),
    y: Number((CY + radius * Math.sin(rad)).toFixed(2)),
  };
}

function lockIconSvg() {
  return svgEl('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', class: 'cipher-wheel__lock-icon' },
    svgEl('path', {
      fill: 'currentColor',
      d: 'M4.5 7V5a3.5 3.5 0 1 1 7 0v2h.5A1.5 1.5 0 0 1 13.5 8.5v5A1.5 1.5 0 0 1 12 15H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 7h.5Zm1.5 0h4V5a2 2 0 1 0-4 0v2Z',
    }));
}

export function cipherWheel({ shift: initialShift = 0, isEasy = true, onChange } = {}) {
  let current = mod26(initialShift);
  let browseIndex = 0;
  let browseAngle = 0;
  let keyAngle = -current * STEP;
  let locked = false;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let lastPointerAngle = 0;
  let pressedRing = null;
  let pressedLetterIndex = null;

  const shiftOut = h('output', { id: 'shift-value' }, current);
  const lockBtn = h('button', {
    type: 'button',
    className: 'button cipher-wheel__lock-btn',
    'aria-pressed': 'false',
    onClick: () => setLocked(!locked),
  }, lockIconSvg(), h('span', {}, 'Lock key'));
  const decBtn = button('−', () => (locked ? setBrowse(browseIndex + 25) : commitShift(current + 25)), { className: 'button stepper', 'aria-label': 'Decrease shift' });
  const incBtn = button('+', () => (locked ? setBrowse(browseIndex + 1) : commitShift(current + 1)), { className: 'button stepper', 'aria-label': 'Increase shift' });

  const hubPair = svgEl('text', { x: CX, y: 168, 'text-anchor': 'middle', class: 'cipher-wheel__pair' }, `A ↔ ${LETTERS[current]}`);
  const hubHint = svgEl('text', { x: CX, y: 189, 'text-anchor': 'middle', class: 'cipher-wheel__mode-cue' }, 'Drag inner ring to set key');

  const outerTicks = LETTERS.map((_, i) => {
    const a = pointAt(i + 0.5, 271);
    const b = pointAt(i + 0.5, 265);
    return svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cipher-wheel__tick' });
  });

  const outerLetters = LETTERS.map((char, i) => {
    const { x, y } = pointAt(i, 244);
    return svgEl('text', {
      x,
      y,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      transform: `rotate(${(i * STEP).toFixed(2)} ${x} ${y})`,
      'data-ring': 'outer',
      'data-letter-index': i,
      class: `cipher-wheel__letter cipher-wheel__letter--plain${i === 0 ? ' cipher-wheel__letter--active' : ''}`,
    }, char);
  });

  const innerTicks = LETTERS.map((_, i) => {
    const a = pointAt(i + 0.5, 211);
    const b = pointAt(i + 0.5, 205);
    return svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cipher-wheel__tick' });
  });

  const innerLetters = LETTERS.map((char, i) => {
    const { x, y } = pointAt(i, 184);
    return svgEl('text', {
      x,
      y,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      transform: `rotate(${(i * STEP).toFixed(2)} ${x} ${y})`,
      'data-ring': 'inner',
      'data-letter-index': i,
      class: `cipher-wheel__letter cipher-wheel__letter--cipher${i === current ? ' cipher-wheel__letter--active' : ''}`,
    }, char);
  });

  const outerGroup = svgEl('g', {
    class: 'cipher-wheel__outer',
    transform: `rotate(0 ${CX} ${CY})`,
  },
  svgEl('circle', { cx: CX, cy: CY, r: 272, class: 'cipher-wheel__outer-ring' }),
  ...outerTicks,
  ...outerLetters);

  const innerGroup = svgEl('g', {
    class: 'cipher-wheel__inner',
    transform: `rotate(${(-current * STEP).toFixed(2)} ${CX} ${CY})`,
  },
  svgEl('circle', { cx: CX, cy: CY, r: 212, class: 'cipher-wheel__inner-ring' }),
  ...innerTicks,
  ...innerLetters);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${VW} ${VH}`,
    class: 'cipher-wheel-svg cipher-wheel-svg--setting-key',
    role: 'img',
    'aria-label': `Caesar cipher wheel, key ${current}, showing A paired with ${LETTERS[current]}`,
  },
  outerGroup,
  innerGroup,
  svgEl('rect', { x: 254, y: 14, width: 52, height: 122, rx: 14, class: 'cipher-wheel__window' }),
  svgEl('polygon', { points: '273,8 287,8 280,16', class: 'cipher-wheel__pointer', 'aria-hidden': 'true' }),
  svgEl('circle', { cx: CX, cy: CY, r: 150, class: 'cipher-wheel__hub' }),
  hubPair,
  hubHint,
  svgEl('text', { x: CX, y: 207, 'text-anchor': 'middle', class: 'cipher-wheel__legend' }, 'OUTER PLAIN · INNER CIPHER'));

  const wheelStage = h('div', {
    className: 'cipher-wheel__stage',
    tabindex: '0',
    role: isEasy ? 'slider' : 'spinbutton',
    'aria-label': isEasy ? 'Encryption shift' : 'Cipher wheel',
    'aria-valuemin': '0',
    'aria-valuemax': '25',
    'aria-valuenow': String(current),
    onKeydown: (event) => {
      if (locked) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setBrowse(browseIndex + 1); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setBrowse(browseIndex + 25); }
        else if (event.key === 'Home') { event.preventDefault(); setBrowse(0); }
      } else {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); commitShift(current + 1); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); commitShift(current + 25); }
        else if (event.key === 'Home') { event.preventDefault(); commitShift(0); }
        else if (event.key === 'End') { event.preventDefault(); commitShift(25); }
      }
    },
  }, svg);

  function syncVisual(customBrowseAngle = null, customKeyAngle = null) {
    const bAngle = customBrowseAngle ?? (-browseIndex * STEP);
    const kAngle = customKeyAngle ?? (-current * STEP);
    const activePlain = mod26(-bAngle / STEP);
    const activeCipher = mod26(activePlain + current);

    outerGroup.setAttribute('transform', `rotate(${bAngle.toFixed(2)} ${CX} ${CY})`);
    innerGroup.setAttribute('transform', `rotate(${(bAngle + kAngle).toFixed(2)} ${CX} ${CY})`);

    for (let i = 0; i < 26; i++) {
      outerLetters[i].setAttribute('class', `cipher-wheel__letter cipher-wheel__letter--plain${i === activePlain ? ' cipher-wheel__letter--active' : ''}`);
      innerLetters[i].setAttribute('class', `cipher-wheel__letter cipher-wheel__letter--cipher${i === activeCipher ? ' cipher-wheel__letter--active' : ''}`);
    }

    const plainChar = LETTERS[activePlain];
    const cipherChar = LETTERS[activeCipher];
    hubPair.textContent = `${plainChar} ↔ ${cipherChar}`;
    hubHint.textContent = locked
      ? `Key ${current === 0 ? '0' : `+${current}`} locked · Drag to browse`
      : 'Drag inner ring to set key';
    shiftOut.textContent = current;
    wheelStage.setAttribute('aria-valuenow', String(current));
    svg.setAttribute('aria-label', `Caesar cipher wheel, key ${current}, showing ${plainChar} paired with ${cipherChar}`);
    svg.setAttribute('class', `cipher-wheel-svg ${locked ? 'cipher-wheel-svg--locked' : 'cipher-wheel-svg--setting-key'}${dragging ? ' cipher-wheel-svg--dragging' : ''}`);
  }

  function setLocked(nextLocked) {
    locked = Boolean(nextLocked);
    lockBtn.setAttribute('aria-pressed', String(locked));
    lockBtn.lastChild.textContent = locked ? 'Key locked' : 'Lock key';
    decBtn.setAttribute('aria-label', locked ? 'Previous letter' : 'Decrease shift');
    incBtn.setAttribute('aria-label', locked ? 'Next letter' : 'Increase shift');
    syncVisual();
  }

  function commitShift(next, customKeyAngle = null) {
    const normalized = mod26(next);
    const changed = normalized !== current;
    current = normalized;
    if (customKeyAngle === null) keyAngle = -current * STEP;
    syncVisual(browseAngle, customKeyAngle);
    if (changed) {
      if (dragging) triggerDetent();
      onChange?.(current);
    }
  }

  function setBrowse(nextIndex, customBrowseAngle = null) {
    const normalized = mod26(nextIndex);
    const changed = normalized !== browseIndex;
    browseIndex = normalized;
    if (customBrowseAngle === null) browseAngle = -browseIndex * STEP;
    syncVisual(customBrowseAngle, keyAngle);
    if (dragging && changed) triggerDetent();
  }

  function pointerAngle(event) {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + (CX / VW) * rect.width;
    const cy = rect.top + (CY / VH) * rect.height;
    return (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI;
  }

  svg.addEventListener('pointerdown', (event) => {
    if (event.button && event.button !== 0) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    lastPointerAngle = pointerAngle(event);
    const hit = event.target?.closest?.('[data-letter-index]');
    pressedRing = hit ? hit.getAttribute('data-ring') : null;
    pressedLetterIndex = hit ? Number(hit.getAttribute('data-letter-index')) : null;
    svg.setPointerCapture?.(event.pointerId);
    syncVisual(browseAngle, keyAngle);
  });

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) >= 6) moved = true;
    const angle = pointerAngle(event);
    let delta = angle - lastPointerAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    lastPointerAngle = angle;

    if (locked) {
      browseAngle += delta;
      setBrowse(Math.round(-browseAngle / STEP), browseAngle);
    } else {
      keyAngle += delta;
      commitShift(Math.round(-keyAngle / STEP), keyAngle);
    }
  });

  function finishDrag(event) {
    if (!dragging) return;
    dragging = false;
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);

    if (!moved && pressedLetterIndex !== null) {
      const idx = pressedLetterIndex;
      const ring = pressedRing;
      pressedLetterIndex = null;
      pressedRing = null;
      if (locked) {
        setBrowse(ring === 'outer' ? idx : idx - current);
      } else if (ring === 'inner') {
        commitShift(idx - browseIndex);
      } else {
        setBrowse(idx);
      }
      return;
    }

    pressedLetterIndex = null;
    pressedRing = null;
    browseAngle = -browseIndex * STEP;
    keyAngle = -current * STEP;
    syncVisual();
  }

  svg.addEventListener('pointerup', finishDrag);
  svg.addEventListener('pointercancel', finishDrag);

  const controls = h('div', { className: 'cipher-wheel-bar' },
    decBtn,
    h('div', { className: 'cipher-wheel__controls-mid' },
      h('span', { className: 'shift-pill' }, 'Key +', shiftOut),
      lockBtn),
    incBtn);

  const element = h('section', { className: 'cipher-wheel-dock', 'aria-label': 'Interactive Caesar cipher wheel' },
    controls,
    h('div', { className: 'cipher-wheel__viewport' }, wheelStage));

  syncVisual();

  return {
    element,
    setShift(next) {
      current = mod26(next);
      keyAngle = -current * STEP;
      syncVisual();
    },
  };
}
