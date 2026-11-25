import { h } from './dom.js';

export function icon(name, className = '') {
  return h('img', { className: `brand-icon ${className}`.trim(), src: `/brand/${name}.svg`, alt: '', width: 64, height: 64 });
}

export function shiftIllustration() {
  return h('div', { className: 'cipher-art', 'aria-hidden': 'true' },
    h('div', { className: 'letter-orbit' },
      h('span', { className: 'orbit-left' }, 'A'),
      h('span', { className: 'orbit-center' }, '+3'),
      h('span', { className: 'orbit-right' }, 'D')),
    h('div', { className: 'art-example' },
      h('span', {}, 'HELLO'),
      h('span', { className: 'art-arrow' }, '→'),
      h('strong', {}, 'KHOOR')));
}
