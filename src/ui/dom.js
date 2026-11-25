export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'className') element.className = value;
    else if (key === 'checked' || key === 'disabled' || key === 'open' || key === 'hidden') element[key] = Boolean(value);
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}

export const button = (text, onClick, attrs = {}) => h('button', { type: 'button', className: 'button', onClick, ...attrs }, text);
export const badge = (text, className = '') => h('span', { className: `badge ${className}`.trim() }, text);

export function panel(title, iconNode, ...children) {
  const opts = (iconNode && typeof iconNode === 'object' && !(iconNode instanceof Node) && !Array.isArray(iconNode))
    ? iconNode
    : { icon: iconNode };
  const bodyChildren = (opts === iconNode) ? children : children;
  const classes = [
    'panel',
    'bp-panel',
    opts.compact ? 'bp-panel--compact' : '',
    opts.active ? 'bp-panel--active' : '',
    opts.className || '',
  ].filter(Boolean).join(' ');

  const titleBlock = h('div', { className: 'bp-panel__title-block' },
    opts.eyebrow ? h('p', { className: 'eyebrow bp-panel__eyebrow' }, opts.eyebrow) : null,
    h('h2', { className: 'bp-panel__title' }, title));

  const head = h('header', { className: 'bp-panel__head' },
    h('div', { className: 'bp-panel__title-row' },
      opts.icon ? h('span', { className: 'bp-panel__icon-tile', 'aria-hidden': 'true' }, opts.icon) : null,
      titleBlock),
    opts.action || null);

  const body = h('div', { className: `bp-panel__body ${opts.bodyClassName || ''}`.trim() }, ...bodyChildren);
  return h('section', { className: classes }, head, body);
}

export function dialog(title, content, { confirm, confirmText = 'Confirm', onCancel, subtitle = '', className = '' } = {}) {
  const previous = document.activeElement;
  const heading = h('div', { className: 'dialog-heading' },
    h('h2', { id: 'dialog-title' }, title),
    subtitle ? h('p', { className: 'dialog-subtitle' }, subtitle) : null);
  const closeBtn = button('×', () => node.close(), { className: 'button bp-modal-close', 'aria-label': 'Close' });
  const actions = confirm
    ? h('div', { className: 'dialog-actions' },
      button('Cancel', () => node.close(), { className: 'button secondary small' }),
      button(confirmText, () => { node.close(); confirm(); }, { className: 'button primary small' }))
    : null;
  const node = h('dialog', { className: className || undefined, 'aria-labelledby': 'dialog-title' },
    h('div', { className: 'dialog-head' }, heading, closeBtn),
    h('div', { className: 'dialog-body' }, content),
    actions);
  node.addEventListener('close', () => { node.remove(); (previous?.isConnected ? previous : document.querySelector('#main'))?.focus(); onCancel?.(); });
  node.addEventListener('click', (event) => { if (event.target === node) { const r = node.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) node.close(); } });
  document.body.append(node); node.showModal(); return node;
}
