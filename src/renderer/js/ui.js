// Kleine Oberflächen-Bausteine: Elemente bauen, Menüs (mit Untermenüs), Dialoge, Hinweise.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (k === 'class') el.className = val;
    else if (k === 'html') el.innerHTML = val;
    else if (k === 'text') el.textContent = val;
    else if (k.startsWith('on') && typeof val === 'function') el.addEventListener(k.slice(2), val);
    else if (k === 'style' && typeof val === 'object') {
      // CSS-Variablen (--c) gehen nur über setProperty
      for (const [sk, sv] of Object.entries(val)) if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
    }
    else el.setAttribute(k, val === true ? '' : val);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- Menüs
// items: [{ label, shortcut, run, checked, disabled, submenu: [...] } | '-' | { header }]
let openMenus = [];
let menuCloseHandler = null;

export function closeMenus() {
  for (const m of openMenus) m.remove();
  openMenus = [];
  document.querySelectorAll('.menubar-item.open, .icon-btn.open, .menu-btn.open').forEach((b) => b.classList.remove('open'));
  if (menuCloseHandler) {
    const f = menuCloseHandler;
    menuCloseHandler = null;
    f();
  }
}
export const menuOpen = () => openMenus.length > 0;

function placeMenu(menu, x, y, alignRight, parentRect) {
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  let left = alignRight ? x - r.width : x;
  let top = y;
  if (parentRect) {
    if (left + r.width > W - 4) left = parentRect.left - r.width + 2;
  }
  left = Math.max(4, Math.min(left, W - r.width - 4));
  if (top + r.height > H - 4) top = Math.max(4, parentRect ? H - r.height - 4 : y - r.height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function showMenu(items, x, y, { alignRight = false, level = 0, parentRect = null, onClose } = {}) {
  if (level === 0) {
    closeMenus();
    menuCloseHandler = onClose || null;
  } else {
    while (openMenus.length > level) openMenus.pop().remove();
  }
  const menu = h('div', { class: 'menu', role: 'menu' });
  let index = -1;
  const rows = [];
  for (const it of items) {
    if (it === '-') {
      menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (it.header) {
      menu.append(h('div', { class: 'menu-header', text: it.header }));
      continue;
    }
    const row = h('div', { class: `menu-item${it.disabled ? ' disabled' : ''}${it.submenu ? ' has-sub' : ''}`, role: 'menuitem' },
      h('span', { class: 'menu-check', text: it.checked ? '✓' : '' }),
      h('span', { class: 'menu-label', text: it.label }),
      h('span', { class: 'menu-key', text: it.submenu ? '›' : it.shortcut || '' }));
    const activate = () => {
      if (it.disabled) return;
      if (it.submenu) {
        const r = row.getBoundingClientRect();
        showMenu(typeof it.submenu === 'function' ? it.submenu() : it.submenu, r.right - 2, r.top - 4, { level: level + 1, parentRect: r });
        return;
      }
      closeMenus();
      it.run && it.run();
    };
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      activate();
    });
    row.addEventListener('mouseenter', () => {
      rows.forEach((x) => x.classList.remove('hot'));
      row.classList.add('hot');
      index = rows.indexOf(row);
      if (it.submenu && !it.disabled) activate();
      else while (openMenus.length > level + 1) openMenus.pop().remove();
    });
    row._activate = activate;
    rows.push(row);
    menu.append(row);
  }
  menu._rows = rows;
  menu._move = (d) => {
    if (!rows.length) return;
    index = (index + d + rows.length) % rows.length;
    rows.forEach((x, i) => x.classList.toggle('hot', i === index));
  };
  menu._enter = () => rows[index] && rows[index]._activate();
  openMenus.push(menu);
  placeMenu(menu, x, y, alignRight, parentRect);
  return menu;
}

document.addEventListener('mousedown', (e) => {
  // Klicks auf den Menüknopf selbst schalten das Menü dort um - nicht hier gleich wieder zu
  if (openMenus.length && !e.target.closest('.menu') && !e.target.closest('.menu-anchor')) closeMenus();
});
window.addEventListener('blur', () => closeMenus());
window.addEventListener('resize', () => closeMenus());
document.addEventListener('keydown', (e) => {
  if (!openMenus.length) return;
  const top = openMenus[openMenus.length - 1];
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (openMenus.length > 1) openMenus.pop().remove();
    else closeMenus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    top._move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    top._enter();
  } else if (e.key === 'ArrowLeft' && openMenus.length > 1) {
    e.preventDefault();
    e.stopPropagation();
    openMenus.pop().remove();
  }
}, true);

// ---------------------------------------------------------------- Dialoge
let dialogStack = [];
export const dialogOpen = () => dialogStack.length > 0;

/**
 * Modaler Dialog. buttons: [{ label, value, primary, danger }]. body: Node.
 * Liefert ein Promise mit dem value des Knopfs (Escape = cancelValue).
 */
export function dialog({ title, body, buttons = [], cancelValue = null, wide = false, className = '', onOpen }) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'overlay' });
    const card = h('div', { class: `dialog ${wide ? 'wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' });
    const close = (value) => {
      overlay.remove();
      dialogStack = dialogStack.filter((d) => d !== overlay);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (dialogStack[dialogStack.length - 1] !== overlay) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(cancelValue);
      } else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.no-enter')) {
        const primary = buttons.find((b) => b.primary);
        if (primary && !e.defaultPrevented) {
          e.preventDefault();
          close(primary.value);
        }
      }
    };
    if (title) card.append(h('div', { class: 'dialog-title', text: title }));
    if (body) card.append(h('div', { class: 'dialog-body' }, body));
    if (buttons.length) {
      const row = h('div', { class: 'dialog-buttons' });
      for (const b of buttons) {
        row.append(h('button', {
          class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}${b.left ? ' left' : ''}`,
          text: b.label,
          onclick: () => close(b.value),
        }));
      }
      card.append(row);
    }
    overlay.append(card);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(cancelValue);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    dialogStack.push(overlay);
    card._close = close;
    if (onOpen) onOpen(card, close);
    else {
      const focus = card.querySelector('input, select, textarea') || card.querySelector('.btn.primary');
      if (focus) setTimeout(() => focus.focus(), 0);
    }
  });
}

export async function confirm(title, message, buttons) {
  return dialog({ title, body: h('p', { class: 'dialog-text', text: message }), buttons, cancelValue: 'cancel' });
}

/** Eingabedialog: liefert Text oder null */
export async function prompt(title, label, value = '', { okLabel = 'OK', cancelLabel = 'Cancel', inputMode } = {}) {
  const input = h('input', { class: 'input', value, inputmode: inputMode, spellcheck: 'false' });
  const body = h('label', { class: 'field' }, h('span', { text: label }), input);
  const res = await dialog({
    title,
    body,
    buttons: [{ label: cancelLabel, value: null }, { label: okLabel, value: 'ok', primary: true }],
    onOpen: () => setTimeout(() => {
      input.focus();
      input.select();
    }, 0),
  });
  return res === 'ok' ? input.value : null;
}

// ---------------------------------------------------------------- Kurze Hinweise
export function toast(text, { kind = '', ms = 2600 } = {}) {
  let host = $('#toasts');
  if (!host) document.body.append((host = h('div', { id: 'toasts' })));
  const el = h('div', { class: `toast ${kind}`, text });
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

/** Tastenkürzel hübsch anzeigen (Mod = Strg bzw. ⌘) */
export function keyLabel(spec, mac) {
  if (!spec) return '';
  return spec.split('+').map((p) => {
    if (p === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (p === 'Alt') return mac ? '⌥' : 'Alt';
    if (p === 'Shift') return mac ? '⇧' : 'Shift';
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(mac ? '' : '+');
}
