/**
 * Robots — lectura de una página para armar un robot (constructor con IA y
 * "Detectar listas"). Sin dependencias de servidor.
 *
 * PAGE_SNAPSHOT_SCRIPT corre DENTRO de la página (paso evaluate, como texto:
 * la CSP del sitio no lo frena) y devuelve:
 *  - html: el body simplificado (sin scripts, estilos ni atributos de más),
 *    recortado para mandarlo a la IA;
 *  - lists: listas que se repiten (tarjetas, filas, resultados) con un
 *    selector de tarjeta verificado, campos propuestos (título, link, imagen,
 *    precio, textos) con su selector relativo y filas de muestra;
 *  - next: un botón o link de "Siguiente" / "Cargar más" si hay.
 */

export interface DetectedField {
  name: string;
  selector: string;
  attribute: string;
}

export interface DetectedList {
  selector: string;
  count: number;
  fields: DetectedField[];
  sample: Array<Record<string, string>>;
}

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
  lists: DetectedList[];
  next: { selector: string; text: string; mode: 'next' | 'load_more' } | null;
}

/** Cuerpo de una función async (paso evaluate). Sin funciones con nombre que dependan de helpers del bundler. */
export const PAGE_SNAPSHOT_SCRIPT = String.raw`
const KEEP = ['id','class','href','src','alt','title','name','type','placeholder','aria-label','role','data-testid','datetime','itemprop'];
const cssEsc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^A-Za-z0-9_-]/g, '\\$&'));
const goodClass = (c) => c && c.length < 40 && !/\d{3,}/.test(c) && !/^(css|sc|jsx|tw|_)-?[a-z0-9]{4,}$/i.test(c) && !/[:\[\]\/@!]/.test(c);
const sig = (el) => el.tagName.toLowerCase() + (Array.from(el.classList).filter(goodClass).slice(0, 2).map((c) => '.' + cssEsc(c)).join(''));
const textOf = (el) => ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

// ---- listas que se repiten ----
const groups = new Map();
for (const parent of Array.from(document.body.querySelectorAll('*')).slice(0, 20000)) {
  const kids = Array.from(parent.children);
  if (kids.length < 3) continue;
  const bySig = new Map();
  for (const k of kids) { const s = sig(k); if (!bySig.has(s)) bySig.set(s, []); bySig.get(s).push(k); }
  for (const [s, els] of bySig) {
    if (els.length < 3) continue;
    const texts = els.map(textOf);
    const avg = texts.reduce((a, t) => a + t.length, 0) / els.length;
    if (avg < 12) continue;
    const linked = els.filter((e) => e.querySelector('a[href]') || e.matches('a[href]')).length / els.length;
    const score = els.length * Math.min(avg, 300) * (0.5 + linked) * (els.some(visible) ? 1 : 0.2);
    const prev = groups.get(s);
    if (!prev || prev.score < score) groups.set(s, { sig: s, els, score });
  }
}
const ranked = Array.from(groups.values()).sort((a, b) => b.score - a.score).slice(0, 8);

const relSel = (card, el) => {
  if (el === card) return '';
  const parts = [];
  let cur = el;
  for (let d = 0; cur && cur !== card && d < 4; d++) {
    const cls = Array.from(cur.classList).filter(goodClass).slice(0, 2).map((c) => '.' + cssEsc(c)).join('');
    parts.unshift(cur.tagName.toLowerCase() + cls);
    const sel = parts.join(' ');
    try { if (card.querySelector(sel) === el) return sel; } catch (e) {}
    cur = cur.parentElement;
  }
  // Sin selector corto único: camino exacto con :nth-of-type desde la tarjeta.
  const exact = [];
  cur = el;
  for (let d = 0; cur && cur !== card && d < 6; d++) {
    const same = cur.parentElement ? Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName) : [cur];
    exact.unshift(cur.tagName.toLowerCase() + (same.length > 1 ? ':nth-of-type(' + (same.indexOf(cur) + 1) + ')' : ''));
    cur = cur.parentElement;
  }
  const path = ':scope > ' + exact.join(' > ');
  try { if (card.querySelector(path) === el) return path; } catch (e) {}
  return parts.join(' ');
};

const fieldsFor = (card) => {
  const out = [];
  const used = new Set();
  const add = (name, el, attribute) => {
    if (!el || out.length >= 8) return;
    const selector = relSel(card, el);
    const k = selector + '|' + attribute;
    if (used.has(k)) return;
    used.add(k);
    let base = name, n = 2;
    while (out.some((f) => f.name === name)) name = base + n++;
    out.push({ name, selector, attribute });
  };
  const heads = Array.from(card.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="title" i],[class*="name" i]'));
  const linkOf = (e) => e.closest('a[href]') || e.querySelector('a[href]');
  const heading = heads.find((e) => textOf(e).length >= 8 && linkOf(e)) || heads.find((e) => textOf(e).length >= 8) || heads.find((e) => textOf(e).length >= 3) || null;
  const links = Array.from(card.querySelectorAll('a[href]'));
  const link = (heading && linkOf(heading) && card.contains(linkOf(heading)) ? linkOf(heading) : null) || links.find((a) => textOf(a).length >= 8) || links[0] || (card.matches('a[href]') ? card : null);
  const titleEl = heading || (link && textOf(link) ? link : null);
  if (titleEl) add('title', titleEl, '');
  if (link) add('link', link, 'href');
  const seenText = new Set(titleEl ? [textOf(titleEl)] : []);
  const price = Array.from(card.querySelectorAll('*')).find((e) => e.children.length === 0 && /([$€£¥₹]|R\$|USD|EUR|ARS)\s?\d|\d[\d.,]*\s?([$€£]|USD|EUR)/.test(textOf(e)) && textOf(e).length < 40);
  if (price) { add('price', price, ''); seenText.add(textOf(price)); }
  const img = card.querySelector('img[src]');
  if (img) add('image', img, 'src');
  const time = card.querySelector('time[datetime]');
  if (time) add('date', time, 'datetime');
  const utility = /^(d|m[tblrxy]?|p[tblrxy]?|col|row|text|flex|f\d|lh|h\d|w\d|v-align|float|color|bg|border|rounded|ml|mr|mb|mt|pl|pr|pb|pt)([-_]|$)/i;
  for (const el of Array.from(card.querySelectorAll('p,span,div,li,td,small,strong,em'))) {
    if (out.length >= 7) break;
    if (el.children.length > 0) continue;
    const t = textOf(el);
    if (t.length < 3 || t.length > 200 || seenText.has(t)) continue;
    if (titleEl && titleEl.contains(el)) continue;
    seenText.add(t);
    const cls = Array.from(el.classList).filter(goodClass).find((c) => /^[a-z][a-z_-]{2,24}$/i.test(c) && !utility.test(c));
    add(cls ? cls.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'text' : 'text', el, '');
  }
  return out.map((f) => ({ ...f, name: /^[A-Za-z_]/.test(f.name) ? f.name.slice(0, 40) : 'f_' + f.name.slice(0, 38) }));
};

const lists = [];
for (const g of ranked) {
  // Selector de tarjeta: la firma, anclada al padre si hace falta para no agarrar de más.
  let selector = g.sig;
  let count = 0;
  try { count = document.querySelectorAll(selector).length; } catch (e) { continue; }
  if (count > g.els.length * 1.5 && g.els[0].parentElement) {
    const p = g.els[0].parentElement;
    const anchored = (p.id && !/\d{3,}/.test(p.id) ? '#' + cssEsc(p.id) : sig(p)) + ' > ' + g.sig;
    try { const n = document.querySelectorAll(anchored).length; if (n >= 3) { selector = anchored; count = n; } } catch (e) {}
  }
  if (lists.some((l) => l.selector === selector)) continue;
  const fields = fieldsFor(g.els[0]);
  if (!fields.length) continue;
  const sample = g.els.slice(0, 5).map((card) => {
    const row = {};
    for (const f of fields) {
      let el = card;
      if (f.selector) { try { el = card.querySelector(f.selector); } catch (e) { el = null; } }
      row[f.name] = !el ? '' : f.attribute ? String(el[f.attribute] || el.getAttribute(f.attribute) || '') : textOf(el).slice(0, 200);
    }
    return row;
  });
  lists.push({ selector, count, fields, sample });
  if (lists.length >= 5) break;
}

// ---- Siguiente / Cargar más ----
let next = null;
const nextRe = /^(next|siguiente|próxima|proxima|próximo|proximo|more|más|mais|›|»|>|→)$/i;
const moreRe = /(load|show|ver|cargar|mostrar|carregar)\s+(more|más|mais)/i;
for (const el of Array.from(document.querySelectorAll('a[href],button,[role=button]')).slice(0, 3000)) {
  const t = textOf(el).slice(0, 40);
  const rel = (el.getAttribute('rel') || '').toLowerCase();
  const isNext = rel === 'next' || nextRe.test(t) || /next/i.test(el.getAttribute('aria-label') || '');
  const isMore = moreRe.test(t);
  if (!isNext && !isMore) continue;
  let selector = '';
  if (rel === 'next') selector = 'a[rel="next"]';
  else if (el.id && !/\d{3,}/.test(el.id)) selector = '#' + cssEsc(el.id);
  else { const s = sig(el); try { if (document.querySelectorAll(s).length === 1) selector = s; } catch (e) {} }
  next = { selector, text: t, mode: isMore ? 'load_more' : 'next' };
  break;
}

// ---- HTML simplificado para la IA ----
const clone = document.body.cloneNode(true);
clone.querySelectorAll('script,style,noscript,svg,template,iframe,link,meta,canvas,video,audio,source,object,embed').forEach((n) => n.remove());
for (const el of Array.from(clone.querySelectorAll('*'))) {
  for (const a of Array.from(el.attributes)) {
    if (!KEEP.includes(a.name)) el.removeAttribute(a.name);
    else if (a.name === 'class') el.setAttribute('class', a.value.split(/\s+/).filter(goodClass).slice(0, 3).join(' '));
    else if (a.value.length > 120) el.setAttribute(a.name, a.value.slice(0, 120));
  }
}
const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
let node;
while ((node = walker.nextNode())) { const v = node.nodeValue.replace(/\s+/g, ' '); node.nodeValue = v.length > 120 ? v.slice(0, 120) + '…' : v; }
const html = clone.innerHTML.replace(/\s+/g, ' ').replace(/<(div|span)>\s*<\/\1>/g, '').slice(0, 40000);
return { url: location.href, title: String(document.title || '').slice(0, 200), html, lists, next };
`;

/** Snapshot que volvió del navegador → forma segura (todo recortado y tipado). */
export function normalizeSnapshot(raw: unknown): PageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const lists: DetectedList[] = (Array.isArray(r.lists) ? r.lists : []).slice(0, 5).flatMap((l) => {
    if (!l || typeof l !== 'object') return [];
    const o = l as Record<string, unknown>;
    const selector = s(o.selector, 500);
    if (!selector) return [];
    const fields = (Array.isArray(o.fields) ? o.fields : [])
      .slice(0, 20)
      .map((f) => {
        const x = (f ?? {}) as Record<string, unknown>;
        return { name: s(x.name, 40).replace(/[^A-Za-z0-9_]/g, '_') || 'field', selector: s(x.selector, 500), attribute: s(x.attribute, 60) };
      })
      .filter((f) => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(f.name));
    const sample = (Array.isArray(o.sample) ? o.sample : []).slice(0, 5).map((row) => {
      const out: Record<string, string> = {};
      for (const f of fields) out[f.name] = s((row as Record<string, unknown> | null)?.[f.name], 200);
      return out;
    });
    return fields.length ? [{ selector, count: Math.max(0, Math.floor(Number(o.count) || 0)), fields, sample }] : [];
  });
  const n = r.next && typeof r.next === 'object' ? (r.next as Record<string, unknown>) : null;
  return {
    url: s(r.url, 2000),
    title: s(r.title, 200),
    html: s(r.html, 40_000),
    lists,
    next: n ? { selector: s(n.selector, 500), text: s(n.text, 60), mode: n.mode === 'load_more' ? 'load_more' : 'next' } : null,
  };
}
