/**
 * Rich text en línea para Docs (fase C) — modelo "HTML-lite".
 *
 * `DocsBlock.content` sigue siendo un string, pero admite un subconjunto
 * sanitizado de HTML: <strong>, <em>, <u>, <s>, <code> y
 * <a href target="_blank" rel="noopener noreferrer">. Todo lo demás se
 * desenvuelve (span/div/styles) o se descarta (script/style/img…).
 *
 * El texto plano heredado (fases A/B) ya es válido: al cargar una página se
 * pasa por `upgradeToHtml`, que escapa lo plano y sanitiza lo que ya trae
 * tags del subset.
 *
 * SIMPLIFICACIÓN documentada: las operaciones de bloque (Enter/split, merge,
 * markdown, slash, menciones) trabajan sobre el TEXTO PLANO (offsets que
 * ignoran tags) vía `splitHtmlAt`. Una marca que cruza el punto de corte se
 * duplica a ambos lados (Range.cloneContents clona los ancestros), así que
 * no se pierde formato; a cambio NO se fusionan tags adyacentes iguales
 * (`<strong>a</strong><strong>b</strong>` es válido y se renderiza igual) y
 * el texto insertado por menciones/slash queda fuera de la marca vecina.
 * Los bloques de código NO usan este modelo: su content es texto escapado.
 */

import { isPageLinkId, pageLinkHref } from './docs-page-links';
import { DAY_RE, RID_RE, TIME_RE } from './docs-dates';

export type DocsMarkTag = 'strong' | 'em' | 'u' | 's' | 'code';

/** Aliases aceptados al sanitizar (paste desde la web, HTML de otros editores). */
const TAG_MAP: Record<string, DocsMarkTag> = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  U: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  CODE: 'code',
};

/** Elementos cuyo contenido se descarta por completo (con sus hijos). */
const DROP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'TEMPLATE',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'IMG',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'SVG',
  'MATH',
  'INPUT',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'FORM',
  'FRAME',
  'FRAMESET',
]);

/** Elementos de bloque: se desenvuelven y aportan un '\n' separador (paste). */
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'HR',
]);

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/** href permitido: http(s), mailto, tel, relativo o ancla. El resto se descarta. */
export function sanitizeHref(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith('/') || h.startsWith('#')) return h;
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h) || /^tel:/i.test(h)) return h;
  return null;
}

type StripMark = DocsMarkTag | 'a' | null;

function serializeChildren(
  el: Element | DocumentFragment,
  out: string[],
  parentMark: DocsMarkTag | null,
  stripMark: StripMark,
): void {
  el.childNodes.forEach((node) => serializeNode(node, out, parentMark, stripMark));
}

function serializeNode(
  node: Node,
  out: string[],
  parentMark: DocsMarkTag | null,
  stripMark: StripMark,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(escapeHtml(node.textContent ?? ''));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName;
  if (DROP_TAGS.has(tag)) return;
  if (tag === 'BR') {
    // <br data-sentinel> es el centinela de línea final vacía del editor: no
    // es contenido del modelo (ver DocsBlockEditor).
    if (!el.hasAttribute('data-sentinel')) out.push('\n');
    return;
  }
  if (tag === 'A') {
    if (stripMark === 'a') {
      serializeChildren(el, out, parentMark, stripMark);
      return;
    }
    // Anchor sin texto (resto de un split en el borde): se descarta.
    if ((el.textContent ?? '') === '') return;
    // Link a otra página (`[[`): el href se rehace desde el id, nunca se copia.
    const page = el.getAttribute('data-page');
    if (page !== null) {
      if (!isPageLinkId(page)) {
        serializeChildren(el, out, parentMark, stripMark);
        return;
      }
      // Link a una fila de una base: también se rehace desde los ids.
      const row = el.getAttribute('data-row');
      if (row !== null && isPageLinkId(row)) out.push(`<a href="${pageLinkHref(page, row)}" data-page="${page}" data-row="${row}">`);
      else out.push(`<a href="${pageLinkHref(page)}" data-page="${page}">`);
      serializeChildren(el, out, null, stripMark);
      out.push('</a>');
      return;
    }
    const href = sanitizeHref(el.getAttribute('href') ?? '');
    if (!href) {
      serializeChildren(el, out, parentMark, stripMark);
      return;
    }
    out.push(`<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`);
    serializeChildren(el, out, null, stripMark);
    out.push('</a>');
    return;
  }
  if (tag === 'SPAN') {
    // Ecuación en línea: el LaTeX vive en data-tex (el render de KaTeX va en
    // un shadow root, así que el texto del span es el LaTeX mismo).
    const tex = el.getAttribute('data-tex');
    if (tex !== null) {
      if (!tex) return;
      out.push(`<span data-tex="${escapeAttr(tex.slice(0, 2000))}">${escapeHtml(tex.slice(0, 2000))}</span>`);
      return;
    }
    // Resaltado de comentario y sugerencias (lib/docs-marks.ts): el span
    // envuelve texto con marcas; se conserva con sus atributos validados.
    const comment = el.getAttribute('data-comment');
    const sug = el.getAttribute('data-sug');
    if (comment !== null || sug !== null) {
      if ((el.textContent ?? '') === '') return;
      const ID = /^[A-Za-z0-9_-]{1,64}$/;
      let open: string | null = null;
      if (comment !== null && ID.test(comment)) open = `<span data-comment="${comment}">`;
      else if (sug !== null && ID.test(sug)) {
        const kind = el.getAttribute('data-sug-kind');
        const by = el.getAttribute('data-sug-by') ?? '';
        if ((kind === 'ins' || kind === 'del') && ID.test(by)) open = `<span data-sug="${sug}" data-sug-kind="${kind}" data-sug-by="${by}">`;
      }
      if (!open) {
        serializeChildren(el, out, parentMark, stripMark);
        return;
      }
      out.push(open);
      serializeChildren(el, out, parentMark, stripMark);
      out.push('</span>');
      return;
    }
    // Mención de fecha (lib/docs-dates.ts): atributos validados, texto tal cual.
    const date = el.getAttribute('data-date');
    if (date !== null && DAY_RE.test(date)) {
      const text = el.textContent ?? '';
      if (!text) return;
      const attrs = [`data-date="${date}"`];
      const time = el.getAttribute('data-time');
      if (time && TIME_RE.test(time)) attrs.push(`data-time="${time}"`);
      const remind = el.getAttribute('data-remind');
      const rid = el.getAttribute('data-rid');
      if (remind && rid && RID_RE.test(rid) && !Number.isNaN(Date.parse(remind))) {
        attrs.push(`data-remind="${new Date(remind).toISOString()}"`, `data-rid="${rid}"`);
      }
      out.push(`<span ${attrs.join(' ')}>${escapeHtml(text)}</span>`);
      return;
    }
  }
  const mark = TAG_MAP[tag];
  if (mark) {
    // Marca sin texto (cloneContents deja wrappers vacíos en los bordes de un
    // split): se descarta con sus hijos (también vacíos).
    if ((el.textContent ?? '') === '') return;
    // stripMark: quitar la marca del rango. parentMark: tag idéntico anidado
    // (p.ej. al envolver una selección ya marcada) → se aplana.
    if (mark === stripMark || mark === parentMark) {
      serializeChildren(el, out, parentMark, stripMark);
      return;
    }
    out.push(`<${mark}>`);
    serializeChildren(el, out, mark, stripMark);
    out.push(`</${mark}>`);
    return;
  }
  if (BLOCK_TAGS.has(tag)) {
    const before = out.length;
    serializeChildren(el, out, parentMark, stripMark);
    if (out.length > before && out[out.length - 1] !== '\n') out.push('\n');
    return;
  }
  // Cualquier otro tag (span, font, b con estilos, etc.): desenvolver.
  serializeChildren(el, out, parentMark, stripMark);
}

/**
 * Documento con `html` como cuerpo. El `<body>` explícito importa: sin él el
 * parser tira los espacios del principio (van antes del body), y un bloque
 * que empieza con espacio (partir justo antes de una palabra) lo perdía.
 */
function parseBody(html: string): Document {
  return new DOMParser().parseFromString(`<!DOCTYPE html><body>${html}`, 'text/html');
}

/** Sanitiza un string de HTML arbitrario al subset permitido. */
export function sanitizeHtml(html: string): string {
  const doc = parseBody(html);
  const out: string[] = [];
  serializeChildren(doc.body, out, null, null);
  return out.join('');
}

/**
 * Serializa el DOM vivo de un contentEditable al modelo HTML-lite.
 * Un bloque sin texto (Chrome deja `<br>` al borrar todo) es ''.
 */
export function serializeEditable(el: HTMLElement): string {
  if ((el.textContent ?? '') === '') return '';
  return sanitizeHtml(el.innerHTML);
}

/** Texto plano del HTML-lite (offsets del modelo; BR/blocks ya son '\n'). */
export function htmlToFlatText(html: string): string {
  if (!html) return '';
  const doc = parseBody(sanitizeHtml(html));
  return doc.body.textContent ?? '';
}

/** Contenido viejo (texto plano) → HTML-lite escapado; si ya trae tags del
 * subset, se sanitiza. Heurística: contiene un tag del subset bien formado. */
const HTML_TAG_RE = /<\/?(?:strong|em|u|s|code|a|span)(?:\s[^>]*)?>/i;

export function upgradeToHtml(content: string): string {
  if (!content) return '';
  if (!HTML_TAG_RE.test(content)) return escapeHtml(content);
  return sanitizeHtml(content);
}

// ---------- Operaciones sobre offsets de TEXTO PLANO ----------

function domFromHtml(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html);
  const host = document.createElement('div');
  host.appendChild(tpl.content.cloneNode(true));
  return host;
}

function resolveTextPoint(root: Node, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  let last: Node | null = null;
  while (node) {
    const len = (node.textContent ?? '').length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    last = node;
    node = walker.nextNode();
  }
  if (last) return { node: last, offset: (last.textContent ?? '').length };
  return null;
}

function serializeFragment(frag: DocumentFragment): string {
  const out: string[] = [];
  serializeChildren(frag, out, null, null);
  return out.join('');
}

function stripMarkFromHtml(html: string, tag: DocsMarkTag | 'a'): string {
  const doc = parseBody(html);
  const out: string[] = [];
  serializeChildren(doc.body, out, null, tag);
  return out.join('');
}

/**
 * Corta el HTML en un offset de texto plano. Las marcas que cruzan el corte
 * se duplican a ambos lados (cloneContents clona los ancestros parciales).
 */
export function splitHtmlAt(html: string, offset: number): [string, string] {
  const host = domFromHtml(html);
  const pos = resolveTextPoint(host, offset);
  if (!pos) {
    const out: string[] = [];
    serializeChildren(host, out, null, null);
    return [out.join(''), ''];
  }
  const before = document.createRange();
  before.selectNodeContents(host);
  before.setEnd(pos.node, pos.offset);
  const after = document.createRange();
  after.selectNodeContents(host);
  after.setStart(pos.node, pos.offset);
  return [serializeFragment(before.cloneContents()), serializeFragment(after.cloneContents())];
}

/** Borra el rango [start, end) de texto plano conservando las marcas externas. */
export function removeHtmlRange(html: string, start: number, end: number): string {
  const [before, rest] = splitHtmlAt(html, start);
  const [, after] = splitHtmlAt(rest, Math.max(0, end - start));
  return before + after;
}

/** Inserta texto (escapado) en un offset de texto plano. */
export function insertTextAtOffset(html: string, offset: number, text: string): string {
  const [before, after] = splitHtmlAt(html, offset);
  return before + escapeHtml(text) + after;
}

function hasAncestorTag(node: Node, tag: DocsMarkTag | 'a'): boolean {
  let el = node.parentElement;
  while (el) {
    if (tag === 'a' ? el.tagName === 'A' : TAG_MAP[el.tagName] === tag) return true;
    el = el.parentElement;
  }
  return false;
}

/** True si TODO el texto del rango [start, end) está dentro de la marca. */
export function isRangeFullyMarked(
  html: string,
  tag: DocsMarkTag,
  start: number,
  end: number,
): boolean {
  if (end <= start) return false;
  const host = domFromHtml(html);
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let covered = 0;
  let node = walker.nextNode();
  while (node) {
    const len = (node.textContent ?? '').length;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    pos = nodeEnd;
    const ovStart = Math.max(nodeStart, start);
    const ovEnd = Math.min(nodeEnd, end);
    if (ovStart < ovEnd) {
      if (!hasAncestorTag(node, tag)) return false;
      covered += ovEnd - ovStart;
    }
    if (nodeStart >= end) break;
    node = walker.nextNode();
  }
  return covered === end - start;
}

/**
 * Toggle de una marca sobre [start, end): si el rango ya está marcado la
 * quita solo de ese tramo (partiendo la marca en los bordes); si no, envuelve
 * el rango (aplanando marcas idénticas anidadas al sanitizar).
 */
export function toggleMark(
  html: string,
  tag: DocsMarkTag,
  start: number,
  end: number,
): string {
  if (end <= start) return html;
  const [before, rest] = splitHtmlAt(html, start);
  const [mid, after] = splitHtmlAt(rest, end - start);
  if (!mid) return html;
  if (isRangeFullyMarked(html, tag, start, end)) {
    return before + stripMarkFromHtml(mid, tag) + after;
  }
  return sanitizeHtml(`${before}<${tag}>${mid}</${tag}>${after}`);
}

/** Envelopa el rango en un <a> (quitando anchors previos del tramo). */
export function wrapLink(html: string, start: number, end: number, href: string): string {
  const clean = sanitizeHref(href);
  if (!clean || end <= start) return html;
  const [before, rest] = splitHtmlAt(html, start);
  const [mid, after] = splitHtmlAt(rest, end - start);
  const stripped = stripMarkFromHtml(mid, 'a');
  if (!stripped) return html;
  return sanitizeHtml(`${before}<a href="${escapeAttr(clean)}">${stripped}</a>${after}`);
}

/** Quita los <a> del rango conservando el texto y el resto de marcas. */
export function unwrapLink(html: string, start: number, end: number): string {
  if (end <= start) return html;
  const [before, rest] = splitHtmlAt(html, start);
  const [mid, after] = splitHtmlAt(rest, end - start);
  return before + stripMarkFromHtml(mid, 'a') + after;
}

/**
 * Si el rango cae dentro de UN solo <a>, devuelve su href y su extensión
 * (offsets de texto plano) para prefill/edicción; si no, null.
 */
export function getLinkAt(
  html: string,
  start: number,
  end: number,
): { start: number; end: number; href: string } | null {
  const host = domFromHtml(html);
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; s: number; e: number }[] = [];
  let pos = 0;
  let node = walker.nextNode();
  while (node) {
    const len = (node.textContent ?? '').length;
    nodes.push({ node, s: pos, e: pos + len });
    pos += len;
    node = walker.nextNode();
  }
  const anchorOf = (n: Node): Element | null => {
    let el = n.parentElement;
    while (el && el.tagName !== 'A') el = el.parentElement;
    return el;
  };
  const findCovering = (s: number, e: number): Element | null => {
    let anchor: Element | null = null;
    for (const n of nodes) {
      if (n.s < e && n.e > s) {
        const a = anchorOf(n.node);
        if (!a) return null;
        if (anchor && anchor !== a) return null;
        anchor = a;
      }
    }
    return anchor;
  };
  // Rango colapsado: se mira el carácter anterior (caret dentro/al final del link).
  const anchor =
    end > start ? findCovering(start, end) : findCovering(Math.max(0, start - 1), Math.max(start, 1));
  if (!anchor) return null;
  let s = Infinity;
  let e = -1;
  for (const n of nodes) {
    let el = n.node.parentElement;
    while (el) {
      if (el === anchor) {
        s = Math.min(s, n.s);
        e = Math.max(e, n.e);
        break;
      }
      el = el.parentElement;
    }
  }
  if (!Number.isFinite(s) || e < 0) return null;
  return { start: s, end: e, href: anchor.getAttribute('href') ?? '' };
}

/**
 * Inserta HTML ya sanitizado en la selección actual (dentro de `el`) y deja
 * el caret justo después. Usado por el paste: no dispara onInput, así que el
 * caller re-serializa el bloque.
 */
export function insertHtmlAtSelection(el: HTMLElement, html: string): void {
  const sel = window.getSelection();
  const append = () => {
    el.insertAdjacentHTML('beforeend', html);
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    if (sel) sel.addRange(range);
  };
  if (!sel || sel.rangeCount === 0) {
    append();
    return;
  }
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) {
    append();
    return;
  }
  range.deleteContents();
  const frag = range.createContextualFragment(html);
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
