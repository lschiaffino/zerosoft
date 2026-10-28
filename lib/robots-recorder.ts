/**
 * Robots — grabador (bookmarklet). Sin dependencias de servidor.
 *
 * El usuario arrastra el bookmarklet a su barra de favoritos, lo abre en el
 * sitio a automatizar y hace los clics/escrituras a mano: el script anota
 * pasos (goto, click, fill, select, press) con selectores robustos y muestra
 * un panel para copiarlos como JSON. En el editor de Robots, "Pegar pasos
 * grabados" los importa (parseRecordedSteps).
 *
 * IMPORTANTE: `generateSelector` es AUTOCONTENIDA (se serializa con
 * toString() dentro del bookmarklet): sin imports ni variables del módulo.
 */
import { validateSteps, type RobotStep } from './robots-schema';

/** Lo que el bookmarklet sabe de un elemento (y sus ancestros). */
export interface ElementInfo {
  tag: string;
  id?: string;
  attrs: Record<string, string>;
  /** Texto visible, recortado. */
  text?: string;
  /** Posición entre hermanos del mismo tag (1-based) y cuántos hay. */
  nth?: number;
  sameTag?: number;
  parent?: ElementInfo | null;
}

export interface GeneratedSelector {
  selector: string;
  /** Para clics: texto visible cuando no hay un selector estable. */
  text?: string;
}

/**
 * Selector robusto, en orden de preferencia: data-testid (data-test, data-qa,
 * data-cy), id estable, name, aria-label, placeholder, texto visible (solo
 * clics) y, como último recurso, un camino CSS corto con :nth-of-type.
 * `isUnique` dice si un selector matchea un solo elemento en la página.
 */
export function generateSelector(
  info: ElementInfo,
  isUnique: (selector: string) => boolean,
  opts: { allowText?: boolean } = {},
): GeneratedSelector {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const tag = (info.tag || 'div').toLowerCase();
  const stableId = (id: string | undefined) =>
    !!id &&
    /^[A-Za-z][\w-]{0,63}$/.test(id) &&
    !/\d{3,}/.test(id) &&
    !/^(ember|react|radix|headlessui|mui|rc|_|:)/i.test(id) &&
    !/^[a-f0-9]{8,}$/i.test(id);
  const attrs = info.attrs || {};
  const tryAll = (candidates: string[]): string | null => {
    for (const c of candidates) if (isUnique(c)) return c;
    return null;
  };

  for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
    const v = attrs[a];
    if (v) {
      const hit = tryAll([`[${a}="${esc(v)}"]`, `${tag}[${a}="${esc(v)}"]`]);
      if (hit) return { selector: hit };
    }
  }
  if (stableId(info.id)) {
    const hit = tryAll([`#${info.id}`]);
    if (hit) return { selector: hit };
  }
  for (const a of ['name', 'aria-label', 'placeholder']) {
    const v = attrs[a];
    if (v && v.length <= 100) {
      const hit = tryAll([`${tag}[${a}="${esc(v)}"]`, `[${a}="${esc(v)}"]`]);
      if (hit) return { selector: hit };
    }
  }
  if (attrs.type === 'submit' && tag !== 'div') {
    const hit = tryAll([`${tag}[type="submit"]`]);
    if (hit) return { selector: hit };
  }
  const text = (info.text || '').replace(/\s+/g, ' ').trim();
  const clickable = ['a', 'button', 'summary', 'label', 'option'].includes(tag) || attrs.role === 'button' || attrs.role === 'link';
  if (opts.allowText && clickable && text && text.length <= 60) return { selector: '', text };

  // Camino CSS: sube hasta un ancestro con id estable o hasta que sea único.
  const segment = (n: ElementInfo) => {
    const t = (n.tag || 'div').toLowerCase();
    return n.sameTag && n.sameTag > 1 && n.nth ? `${t}:nth-of-type(${n.nth})` : t;
  };
  const parts: string[] = [segment(info)];
  let cur = info.parent ?? null;
  for (let depth = 0; depth < 6; depth++) {
    const sel = parts.join(' > ');
    if (isUnique(sel)) return { selector: sel };
    if (!cur) break;
    if (stableId(cur.id)) {
      const anchored = `#${cur.id} > ${sel}`;
      if (isUnique(anchored)) return { selector: anchored };
    }
    const tagName = (cur.tag || '').toLowerCase();
    if (tagName === 'body' || tagName === 'html') {
      return { selector: `body > ${sel}` };
    }
    parts.unshift(segment(cur));
    cur = cur.parent ?? null;
  }
  return { selector: parts.join(' > ') };
}

/**
 * Selectores alternativos de un elemento (autorreparación): los únicos entre
 * data-testid, id, name, aria-label, placeholder, clases estables y el camino
 * CSS, menos el elegido. AUTOCONTENIDA (va al bookmarklet).
 */
export function selectorAlternatives(el: Element, chosen: string, isUnique: (selector: string) => boolean, path: string): string[] {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const tag = el.tagName.toLowerCase();
  const cands: string[] = [];
  for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label', 'placeholder', 'title']) {
    const v = el.getAttribute(a);
    if (v && v.length <= 100) cands.push(`${tag}[${a}="${esc(v)}"]`);
  }
  if (el.id && /^[A-Za-z][\w-]{0,63}$/.test(el.id)) cands.push(`#${el.id}`);
  const cls = Array.from(el.classList || [])
    .filter((c) => /^[A-Za-z][\w-]{1,39}$/.test(c) && !/\d{3,}/.test(c))
    .slice(0, 2);
  if (cls.length) cands.push(`${tag}.${cls.join('.')}`);
  if (path) cands.push(path);
  const out: string[] = [];
  for (const c of cands) {
    if (!c || c === chosen || out.includes(c)) continue;
    let ok = false;
    try {
      ok = isUnique(c);
    } catch {
      ok = false;
    }
    if (ok) out.push(c);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * "Capturar lista": desde el elemento tocado, la tarjeta que se repite (un
 * ancestro con al menos 3 hermanos del mismo tag y clase) y su selector.
 * AUTOCONTENIDA (va al bookmarklet).
 */
export function findListCard(el: Element): { card: Element; selector: string; count: number } | null {
  const good = (c: string) => /^[A-Za-z][\w-]{1,39}$/.test(c) && !/\d{3,}/.test(c);
  const sig = (n: Element) => {
    const cls = Array.from(n.classList || []).filter(good).slice(0, 2);
    return n.tagName.toLowerCase() + cls.map((c) => `.${c}`).join('');
  };
  let cur: Element | null = el;
  for (let depth = 0; cur && cur.parentElement && depth < 12; depth++) {
    const parent: Element = cur.parentElement;
    const s = sig(cur);
    const same = Array.from(parent.children).filter((c) => sig(c) === s);
    if (same.length >= 3 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
      let selector = s;
      let count = 0;
      try {
        count = document.querySelectorAll(selector).length;
      } catch {
        count = 0;
      }
      // Si la firma agarra de más en la página, se ancla al padre.
      if (count > same.length * 1.5) {
        const anchored = `${parent.id && /^[A-Za-z][\w-]{0,63}$/.test(parent.id) ? `#${parent.id}` : sig(parent)} > ${s}`;
        try {
          const n = document.querySelectorAll(anchored).length;
          if (n >= 3) {
            selector = anchored;
            count = n;
          }
        } catch {
          // queda la firma
        }
      }
      return { card: cur, selector, count };
    }
    cur = parent;
  }
  return null;
}

/** Selector de `el` relativo a la tarjeta ('' = la tarjeta). AUTOCONTENIDA (va al bookmarklet). */
export function relativeSelector(card: Element, el: Element): string {
  if (el === card) return '';
  const good = (c: string) => /^[A-Za-z][\w-]{1,39}$/.test(c) && !/\d{3,}/.test(c);
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let d = 0; cur && cur !== card && d < 5; d++) {
    const cls = Array.from(cur.classList || []).filter(good).slice(0, 2);
    parts.unshift(cur.tagName.toLowerCase() + cls.map((c) => `.${c}`).join(''));
    const s = parts.join(' ');
    try {
      if (card.querySelector(s) === el) return s;
    } catch {
      // sigue subiendo
    }
    cur = cur.parentElement;
  }
  const exact: string[] = [];
  cur = el;
  for (let d = 0; cur && cur !== card && d < 6; d++) {
    const node: Element = cur;
    const same = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [node];
    exact.unshift(node.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''));
    cur = node.parentElement;
  }
  return `:scope > ${exact.join(' > ')}`;
}

export interface RecorderLabels {
  recording: string;
  steps: string;
  copy: string;
  copied: string;
  clear: string;
  close: string;
  hint: string;
  /** Captura de datos (opcionales: los tests viejos arman el grabador sin ellos). */
  text?: string;
  list?: string;
  next?: string;
  done?: string;
  pickText?: string;
  pickList?: string;
  pickNext?: string;
  listCount?: string;
}

/** Placeholder de contraseñas: el valor real nunca se graba. */
export const PASSWORD_PLACEHOLDER = '{{credentials.LOGIN.password}}';

/** Código JS del grabador (lo que corre en la página del usuario). */
export function buildRecorderScript(labels: RecorderLabels): string {
  const L = JSON.stringify(labels);
  return `(function(){
if (window.__zsRecorder) { window.__zsRecorder.show(); return; }
var __name = function (f) { return f; };
var L = ${L};
var KEY = 'zerosoft-robot-recorder';
var gen = ${generateSelector.toString()};
var altsOf = ${selectorAlternatives.toString()};
var findCard = ${findListCard.toString()};
var relSel = ${relativeSelector.toString()};
var mode = null;
var listCard = null;
var state;
try { state = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { state = null; }
if (!state || !Array.isArray(state.steps)) state = { steps: [], last: '' };
if (state.last !== location.href) state.steps.push({ type: 'goto', url: location.href });
function save() { state.last = location.href; try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} render(); }
function info(el, depth) {
  if (!el || el.nodeType !== 1) return null;
  var attrs = {};
  ['data-testid','data-test','data-qa','data-cy','name','aria-label','placeholder','type','role'].forEach(function (a) { var v = el.getAttribute(a); if (v) attrs[a] = v; });
  var same = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName; }) : [el];
  return { tag: el.tagName.toLowerCase(), id: el.id || undefined, attrs: attrs, text: (el.innerText || el.textContent || '').trim().slice(0, 80),
    nth: same.indexOf(el) + 1, sameTag: same.length, parent: depth < 8 ? info(el.parentElement, depth + 1) : null };
}
function unique(sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } }
function sel(el, allowText) {
  var r = gen(info(el, 0), unique, { allowText: !!allowText });
  // Alternativos para la autorreparación (si el principal deja de existir).
  try {
    var path = r.selector ? gen(info(el, 0), function () { return false; }, {}).selector : '';
    var alts = altsOf(el, r.selector, unique, path);
    if (alts.length && r.selector) r.fallbacks = alts;
  } catch (e) {}
  return r;
}
function withAlts(step, s) { if (s.fallbacks && s.fallbacks.length) step.fallbacks = s.fallbacks; return step; }
function varName(base) { var names = state.steps.map(function (s) { return s.name; }); if (names.indexOf(base) < 0) return base; var n = 2; while (names.indexOf(base + n) >= 0) n++; return base + n; }
function fieldName(el, fields) {
  var t = (el.tagName || '').toLowerCase();
  var inHeading = el.closest && el.closest('h1,h2,h3,h4,h5,h6');
  var cls = Array.prototype.filter.call(el.classList || [], function (c) { return /^[a-z][a-z_-]{2,24}$/i.test(c); })[0];
  var base = t === 'img' ? 'image' : inHeading ? 'title' : t === 'time' ? 'date' : cls ? cls.replace(/[^A-Za-z0-9]+/g, '_') : 'field';
  if (!fields.some(function (f) { return f.name === base; })) return base;
  var n = 2; while (fields.some(function (f) { return f.name === base + n; })) n++; return base + n;
}
function setMode(m) {
  mode = m;
  if (!m) listCard = null;
  var hint = m === 'text' ? L.pickText : m === 'list' ? L.pickList : m === 'next' ? L.pickNext : L.hint;
  try { q('.m').textContent = hint || L.hint; q('.k').style.display = m === 'list' ? '' : 'none'; } catch (e) {}
  outline(null);
}
var lit = null;
function outline(el) {
  if (lit) { try { lit.style.outline = lit.__zsOutline || ''; } catch (e) {} lit = null; }
  if (el && mode) { try { el.__zsOutline = el.style.outline; el.style.outline = '2px solid #dc2626'; lit = el; } catch (e) {} }
}
function capture(t) {
  var el = t.closest ? t.closest('a,button,img,time,h1,h2,h3,h4,h5,h6,p,span,li,td,th,strong,em,small,div') || t : t;
  if (mode === 'text') {
    var s = sel(el);
    var isImg = el.tagName === 'IMG';
    push(withAlts({ type: 'extract', selector: s.selector, name: varName('text'), mode: isImg ? 'attribute' : 'text', attribute: isImg ? 'src' : '' }, s));
    setMode(null);
    return;
  }
  if (mode === 'next') {
    var last = null;
    for (var i = state.steps.length - 1; i >= 0; i--) if (state.steps[i].type === 'extract_list') { last = state.steps[i]; break; }
    var b = t.closest ? t.closest('a,button,[role=button]') || t : t;
    var bs = sel(b, true);
    var label = (b.innerText || b.textContent || '').trim().slice(0, 60);
    if (last) {
      if (bs.selector) last.nextSelector = bs.selector;
      if (label) last.nextText = label;
      last.maxPages = 5;
      last.pageWaitMs = 1000;
      if (/more|más|mais|load|cargar|carregar|ver/i.test(label) && !/next|siguiente|próxim/i.test(label)) last.paginateMode = 'load_more';
      save();
    }
    setMode(null);
    return;
  }
  if (mode === 'list') {
    var list = state.steps.length ? state.steps[state.steps.length - 1] : null;
    if (!listCard || !list || list.type !== 'extract_list') {
      var found = findCard(el);
      if (!found) return;
      listCard = found.card;
      list = { type: 'extract_list', selector: found.selector, name: varName('items'), fields: [], max: 100 };
      if (state.steps.length >= 100) return;
      state.steps.push(list);
    } else if (!listCard.contains(el)) {
      var other = findCard(el);
      if (!other || other.selector !== list.selector) return;
      // Otra tarjeta de la misma lista: el campo se toma relativo a esa.
      listCard = other.card;
    }
    var link = el.closest ? el.closest('a[href]') : null;
    var target = el.tagName === 'IMG' ? el : el;
    var rs = relSel(listCard, target);
    if (target.tagName === 'IMG') list.fields.push({ name: fieldName(target, list.fields), selector: rs, attribute: 'src' });
    else {
      if (list.fields.length < 20) list.fields.push({ name: fieldName(target, list.fields), selector: rs, attribute: '' });
      if (link && listCard.contains(link) && list.fields.length < 20 && !list.fields.some(function (f) { return f.attribute === 'href'; })) {
        list.fields.push({ name: list.fields.some(function (f) { return f.name === 'link'; }) ? fieldName(link, list.fields) : 'link', selector: relSel(listCard, link), attribute: 'href' });
      }
    }
    save();
    try { q('.k').textContent = (L.done || 'Done') + ' · ' + (L.listCount || '{count}').replace('{count}', String(document.querySelectorAll(list.selector).length)); } catch (e) {}
  }
}
function inPanel(el) { return host && (el === host || host.contains(el)); }
function push(step) {
  var prev = state.steps[state.steps.length - 1];
  if (prev && step.type === 'fill' && prev.type === 'fill' && prev.selector === step.selector) { prev.value = step.value; save(); return; }
  if (state.steps.length >= 100) return;
  state.steps.push(step); save();
}
// Campos secretos: nunca se graba su valor. Además de type=password, cuentan los que
// alguna vez fueron password (botón "mostrar contraseña"), los de autocomplete de
// contraseña / OTP / tarjeta, los que ocultan el texto con text-security y los PIN.
var wasPw = typeof WeakSet === 'function' ? new WeakSet() : null;
function markPw(el) { if (wasPw && el && el.nodeType === 1 && (el.type || '').toLowerCase() === 'password') wasPw.add(el); }
function secret(el) {
  var type = (el.type || '').toLowerCase();
  if (type === 'password') { markPw(el); return true; }
  if (wasPw && wasPw.has(el)) return true;
  var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  if (/current-password|new-password|one-time-code|cc-number|cc-csc/.test(ac)) return true;
  try { var cs = getComputedStyle(el); var ts = cs.getPropertyValue('-webkit-text-security') || cs.webkitTextSecurity || ''; if (ts && ts !== 'none') return true; } catch (e) {}
  var names = ((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
  if (/passw|pwd|contrase|senha/.test(names)) return true;
  var numeric = (el.getAttribute('inputmode') || '').toLowerCase() === 'numeric' || type === 'tel' || type === 'number';
  return numeric && /(^|[^a-z])(pin|otp|cvv|cvc|card|token|code)/.test(names);
}
document.addEventListener('focusin', function (e) { markPw(e.target); }, true);
document.addEventListener('mouseover', function (e) {
  if (!mode) return;
  var t = e.target; if (!t || t.nodeType !== 1 || inPanel(t)) return;
  outline(t);
}, true);
document.addEventListener('click', function (e) {
  var t = e.target; if (!t || t.nodeType !== 1 || inPanel(t)) return;
  // Captura de datos: el clic marca qué extraer y no llega a la página.
  if (mode) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); capture(t); return; }
  var el = t.closest('a,button,summary,label,[role=button],[role=link],input[type=submit],input[type=button],input[type=checkbox],input[type=radio]') || t;
  var tag = el.tagName.toLowerCase();
  if ((tag === 'input' && !/^(submit|button|checkbox|radio|reset)$/i.test(el.type || '')) || tag === 'textarea' || tag === 'select') return;
  var s = sel(el, true);
  push(withAlts({ type: 'click', selector: s.selector, text: s.text || '' }, s));
}, true);
document.addEventListener('change', function (e) {
  var el = e.target; if (!el || el.nodeType !== 1 || inPanel(el)) return;
  var tag = el.tagName.toLowerCase();
  if (tag === 'select') { push({ type: 'select', selector: sel(el).selector, value: el.value }); return; }
  if (tag === 'textarea' || (tag === 'input' && !/^(submit|button|checkbox|radio|reset|file|hidden)$/i.test(el.type || ''))) {
    var fill = { type: 'fill', selector: sel(el).selector, value: secret(el) ? ${JSON.stringify(PASSWORD_PLACEHOLDER)} : el.value };
    // Enter ya grabó fill + press: el change que dispara el navegador al confirmar no se repite.
    var n = state.steps.length, last = state.steps[n - 1], before = state.steps[n - 2];
    if (last && last.type === 'press' && last.key === 'Enter' && last.selector === fill.selector && before && before.type === 'fill' && before.selector === fill.selector && before.value === fill.value) return;
    push(fill);
  }
}, true);
document.addEventListener('keydown', function (e) {
  if (mode && e.key === 'Escape') { e.preventDefault(); setMode(null); return; }
  var el = e.target; markPw(el); if (e.key !== 'Enter' || !el || el.nodeType !== 1 || inPanel(el)) return;
  var tag = el.tagName.toLowerCase(); if (tag !== 'input') return;
  if (el.value) push({ type: 'fill', selector: sel(el).selector, value: secret(el) ? ${JSON.stringify(PASSWORD_PLACEHOLDER)} : el.value });
  push({ type: 'press', key: 'Enter', selector: sel(el).selector });
}, true);
var host = document.createElement('div');
host.setAttribute('data-zerosoft-recorder', '');
host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
root.innerHTML = '<style>.p{font:13px/1.4 system-ui,sans-serif;background:#fff;color:#111;border:1px solid #d4d4d4;border-radius:4px;padding:10px 12px;width:260px;box-shadow:0 4px 16px rgba(0,0,0,.08)}.h{display:flex;align-items:center;gap:6px;font-weight:600}.d{width:7px;height:7px;border-radius:50%;background:#dc2626}.m{color:#666;margin:6px 0 8px;font-size:12px}.r{display:flex;gap:6px}button{font:inherit;font-size:12px;border:1px solid #d4d4d4;background:#fff;border-radius:3px;padding:4px 8px;cursor:pointer}button.s{background:#111;color:#fff;border-color:#111}</style><div class="p"><div class="h"><span class="d"></span><span class="t"></span></div><div class="m"></div><div class="r"><button class="s c"></button><button class="x"></button><button class="q"></button></div><div class="r" style="margin-top:6px"><button class="e1"></button><button class="e2"></button><button class="e3"></button></div><div class="r" style="margin-top:6px"><button class="s k" style="display:none"></button></div></div>';
var q = function (c) { return root.querySelector(c); };
q('.m').textContent = L.hint; q('.c').textContent = L.copy; q('.x').textContent = L.clear; q('.q').textContent = L.close;
q('.e1').textContent = L.text || 'Capture text'; q('.e2').textContent = L.list || 'Capture list'; q('.e3').textContent = L.next || 'Next page'; q('.k').textContent = L.done || 'Done';
q('.e1').addEventListener('click', function () { setMode(mode === 'text' ? null : 'text'); });
q('.e2').addEventListener('click', function () { listCard = null; setMode(mode === 'list' ? null : 'list'); });
q('.e3').addEventListener('click', function () { setMode(mode === 'next' ? null : 'next'); });
q('.k').addEventListener('click', function () { setMode(null); });
function render() { q('.t').textContent = L.recording + ' · ' + state.steps.length + ' ' + L.steps; }
q('.c').addEventListener('click', function () {
  var text = JSON.stringify({ zerosoftRobotSteps: 1, steps: state.steps }, null, 2);
  var done = function () { q('.c').textContent = L.copied; setTimeout(function () { q('.c').textContent = L.copy; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt(L.copy, text); });
  else { prompt(L.copy, text); }
});
q('.x').addEventListener('click', function () { state = { steps: [{ type: 'goto', url: location.href }], last: location.href }; save(); });
q('.q').addEventListener('click', function () { host.style.display = 'none'; });
document.documentElement.appendChild(host);
window.__zsRecorder = { show: function () { host.style.display = ''; } };
save();
})();`;
}

/** href del bookmarklet. */
export function recorderBookmarklet(labels: RecorderLabels): string {
  return `javascript:${encodeURIComponent(buildRecorderScript(labels))}`;
}

export type ParseRecordedResult = { ok: true; steps: RobotStep[] } | { ok: false; error: 'invalid_json' | 'no_steps' | 'invalid_steps'; index?: number };

/**
 * Pasos pegados desde el grabador: acepta { steps: [...] } o un array. Se
 * descartan claves desconocidas y se validan con el mismo esquema del editor.
 */
export function parseRecordedSteps(text: string): ParseRecordedResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as { steps?: unknown }).steps : null;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'no_steps' };
  const v = validateSteps(list);
  if (!v.ok) return { ok: false, error: 'invalid_steps', index: v.index };
  return { ok: true, steps: dropRefillAfterEnter(v.steps) };
}

/**
 * Grabaciones viejas: fill → Enter → mismo fill (el change que sigue al Enter).
 * El último fill sobra y, si Enter envió el formulario, falla en la página nueva.
 */
function dropRefillAfterEnter(steps: RobotStep[]): RobotStep[] {
  const out: RobotStep[] = [];
  for (const s of steps) {
    const last = out.at(-1);
    const before = out.at(-2);
    if (
      s.type === 'fill' &&
      last?.type === 'press' &&
      last.key === 'Enter' &&
      before?.type === 'fill' &&
      last.selector === s.selector &&
      before.selector === s.selector &&
      before.value === s.value
    ) {
      continue;
    }
    out.push(s);
  }
  return out;
}
