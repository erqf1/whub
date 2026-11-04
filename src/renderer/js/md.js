// Release-Notizen (Markdown von GitHub) sicher als DOM bauen: nur Text-Knoten, nie innerHTML.
// Kann: Überschriften, Absätze, Listen (auch eingerückt), **fett**, *kursiv*, `code` und [Links](https://...).
import { h } from './ui.js';

function inline(text, openLink) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|(https:\/\/[^\s)]+))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] || m[3]) out.push(h('b', {}, ...inline(m[2] || m[3], openLink)));
    else if (m[4]) out.push(h('code', { text: m[4] }));
    else if (m[5]) {
      const url = m[6];
      out.push(h('a', { href: '#', title: url, onclick: (e) => { e.preventDefault(); openLink(url); } }, m[5]));
    } else if (m[7] || m[8]) out.push(h('i', {}, ...inline(m[7] || m[8], openLink)));
    else if (m[9]) {
      const url = m[9];
      out.push(h('a', { href: '#', title: url, onclick: (e) => { e.preventDefault(); openLink(url); } }, url.replace(/^https:\/\/(www\.)?/, '')));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function markdown(src, openLink) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) root.append(h('p', {}, ...inline(para.join(' '), openLink)));
    para = [];
  };
  const flushList = () => {
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (/^<!--.*-->$/.test(line.trim()) || /^\s*<\/?[a-z][^>]*>\s*$/i.test(line)) continue; // HTML-Reste weglassen
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      flushPara();
      flushList();
      root.append(h(head[1].length <= 2 ? 'h3' : 'h4', {}, ...inline(head[2], openLink)));
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushPara();
      flushList();
      root.append(h('hr'));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const deep = item[1].length >= 2;
      if (!list) {
        list = { el: h(/\d/.test(item[2]) ? 'ol' : 'ul'), sub: null };
        root.append(list.el);
      }
      const li = h('li', {}, ...inline(item[3], openLink));
      if (deep && list.el.lastElementChild) {
        if (!list.sub || list.sub.parentNode !== list.el.lastElementChild) {
          list.sub = h('ul');
          list.el.lastElementChild.append(list.sub);
        }
        list.sub.append(li);
      } else {
        list.el.append(li);
        list.sub = null;
      }
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw) && list.el.lastElementChild) {
      list.el.lastElementChild.append(' ', ...inline(line.trim(), openLink));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  return root;
}
