import { h, badge } from './dom.js';

export function icon(name, className = '') {
  return h('img', { className: `brand-icon ${className}`.trim(), src: `/brand/${name}.svg`, alt: '', width: 64, height: 64 });
}

export function intro(kicker, title, description, asset, note) {
  return h('div', { className: 'setup-intro' }, icon(asset, 'intro-icon'), badge(kicker), h('h1', {}, title), h('p', { className: 'lead' }, description), h('p', { className: 'intro-note' }, note));
}

export function shiftIllustration() {
  return h('div', { className: 'cipher-art', 'aria-hidden': 'true' },
    h('div', { className: 'art-heading' }, h('span', { className: 'eyebrow' }, 'A LITTLE SHIFT IN PERSPECTIVE'), icon('key')),
    h('div', { className: 'letter-orbit' }, h('span', { className: 'orbit-left' }, 'A'), h('span', { className: 'orbit-center' }, '+3'), h('span', { className: 'orbit-right' }, 'D')),
    h('div', { className: 'art-example' }, h('span', {}, 'HELLO, WORLD!'), h('strong', {}, 'KHOOR, ZRUOG!')),
    h('p', { className: 'art-caption' }, 'One alphabet. A new starting point.'));
}
