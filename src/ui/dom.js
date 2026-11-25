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
export const badge = (text) => h('span', { className: 'badge' }, text);
export function dialog(title, content, { confirm, confirmText = 'Confirm', onCancel } = {}) {
  const previous = document.activeElement;
  const node = h('dialog', { 'aria-labelledby': 'dialog-title' }, h('div', { className: 'dialog-head' }, h('h2', { id: 'dialog-title' }, title), button('Close', () => node.close(), { className: 'button quiet' })), content, confirm ? button(confirmText, () => { node.close(); confirm(); }, { className: 'button primary' }) : null);
  node.addEventListener('close', () => { node.remove(); (previous?.isConnected ? previous : document.querySelector('#main'))?.focus(); onCancel?.(); });
  node.addEventListener('click', (event) => { if (event.target === node) { const r = node.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) node.close(); } });
  document.body.append(node); node.showModal(); return node;
}
