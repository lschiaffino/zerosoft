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

export interface RecorderLabels {
  recording: string;
  steps: string;
  copy: string;
  copied: string;
  clear: string;
  close: string;
  hint: string;
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
function sel(el, allowText) { return gen(info(el, 0), unique, { allowText: !!allowText }); }
function inPanel(el) { return host && (el === host || host.contains(el)); }
function push(step) {
  var prev = state.steps[state.steps.length - 1];
  if (prev && step.type === 'fill' && prev.type === 'fill' && prev.selector === step.selector) { prev.value = step.value; save(); return; }
  if (state.steps.length >= 100) return;
  state.steps.push(step); save();
}
document.addEventListener('click', function (e) {
  var t = e.target; if (!t || t.nodeType !== 1 || inPanel(t)) return;
  var el = t.closest('a,button,summary,label,[role=button],[role=link],input[type=submit],input[type=button],input[type=checkbox],input[type=radio]') || t;
  var tag = el.tagName.toLowerCase();
  if ((tag === 'input' && !/^(submit|button|checkbox|radio|reset)$/i.test(el.type || '')) || tag === 'textarea' || tag === 'select') return;
  var s = sel(el, true);
  push({ type: 'click', selector: s.selector, text: s.text || '' });
}, true);
document.addEventListener('change', function (e) {
  var el = e.target; if (!el || el.nodeType !== 1 || inPanel(el)) return;
  var tag = el.tagName.toLowerCase();
  if (tag === 'select') { push({ type: 'select', selector: sel(el).selector, value: el.value }); return; }
  if (tag === 'textarea' || (tag === 'input' && !/^(submit|button|checkbox|radio|reset|file|hidden)$/i.test(el.type || ''))) {
    var pw = (el.type || '').toLowerCase() === 'password';
    push({ type: 'fill', selector: sel(el).selector, value: pw ? ${JSON.stringify(PASSWORD_PLACEHOLDER)} : el.value });
  }
}, true);
document.addEventListener('keydown', function (e) {
  var el = e.target; if (e.key !== 'Enter' || !el || el.nodeType !== 1 || inPanel(el)) return;
  var tag = el.tagName.toLowerCase(); if (tag !== 'input') return;
  if (el.value) { var pw = (el.type || '').toLowerCase() === 'password'; push({ type: 'fill', selector: sel(el).selector, value: pw ? ${JSON.stringify(PASSWORD_PLACEHOLDER)} : el.value }); }
  push({ type: 'press', key: 'Enter', selector: sel(el).selector });
}, true);
var host = document.createElement('div');
host.setAttribute('data-zerosoft-recorder', '');
host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
root.innerHTML = '<style>.p{font:13px/1.4 system-ui,sans-serif;background:#fff;color:#111;border:1px solid #d4d4d4;border-radius:4px;padding:10px 12px;width:260px;box-shadow:0 4px 16px rgba(0,0,0,.08)}.h{display:flex;align-items:center;gap:6px;font-weight:600}.d{width:7px;height:7px;border-radius:50%;background:#dc2626}.m{color:#666;margin:6px 0 8px;font-size:12px}.r{display:flex;gap:6px}button{font:inherit;font-size:12px;border:1px solid #d4d4d4;background:#fff;border-radius:3px;padding:4px 8px;cursor:pointer}button.s{background:#111;color:#fff;border-color:#111}</style><div class="p"><div class="h"><span class="d"></span><span class="t"></span></div><div class="m"></div><div class="r"><button class="s c"></button><button class="x"></button><button class="q"></button></div></div>';
var q = function (c) { return root.querySelector(c); };
q('.m').textContent = L.hint; q('.c').textContent = L.copy; q('.x').textContent = L.clear; q('.q').textContent = L.close;
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
  return { ok: true, steps: v.steps };
}
