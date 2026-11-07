/**
 * Limpieza de lo que trae una grabación antes de guardarla. El snippet hace lo
 * mismo antes de mandar (public/zs.js); acá se repite porque el pedido viene del
 * navegador: un snippet viejo o un cliente armado a mano no lo hace.
 *
 * Siempre: sin manejadores inline, sin data-*, sin placeholders, sin valores de
 * campos ocultos, opciones ni botones, y lo editable enmascarado.
 * En modo enmascarado (el de fábrica) además: ninguna URL conserva su query ni
 * su fragmento, también en CSS, y todo texto visible va con asteriscos.
 */
const SECRET_PARAM = /token|secret|password|passwd|auth|session|signature|sig$|code|key|otp|jwt|email/i;
/** Atributos con una URL. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'data', 'ping', 'background', 'longdesc', 'xlink:href']);
const TEXT_ATTRS = new Set(['title', 'aria-label', 'alt', 'aria-description', 'aria-placeholder', 'label']);
const NODE_ELEMENT = 2;
const NODE_TEXT = 3;

type Rec = Record<string, unknown>;
const isObject = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ScrubOptions {
  masked: boolean;
}

/** URL (absoluta o relativa) sin fragmento y sin los parámetros que no pueden quedar. Conserva si era relativa. */
export function scrubUrl(raw: string, masked = true): string {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return value ? '#' : value;
  if (/^(mailto|tel|javascript):/i.test(value)) return '';
  if (/^(data|blob):/i.test(value)) return value;
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//');
  try {
    const u = new URL(value, 'https://zs.invalid');
    u.hash = '';
    if (masked) u.search = '';
    else for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k) && !/^utm_/i.test(k)) u.searchParams.delete(k);
    return relative ? `${u.pathname}${u.search}` : u.toString();
  } catch {
    return '';
  }
}

/** URLs dentro de CSS (url(...) y @import), sin query ni fragmento: acá nunca hacen falta. */
export function scrubCss(css: string): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, q: string, url: string) => (/^data:/i.test(url) ? `url(${q}${url}${q})` : `url(${q}${url.replace(/[?#].*$/, '')}${q})`))
    .replace(/@import\s+(['"])([^'"]*)\1/gi, (_m, q: string, url: string) => `@import ${q}${url.replace(/[?#].*$/, '')}${q}`);
}

const maskText = (s: string) => s.replace(/\S/g, '*');

function scrubAttributes(attrs: Rec, tag: string, opt: ScrubOptions): void {
  const type = String(attrs.type ?? '').toLowerCase();
  for (const key of Object.keys(attrs)) {
    const k = key.toLowerCase();
    const v = attrs[key];
    if (k.startsWith('on') || k.startsWith('data-') || k === 'placeholder' || k === 'nonce' || k === 'integrity' || k === 'srcset') {
      delete attrs[key];
    } else if (URL_ATTRS.has(k) && typeof v === 'string') {
      attrs[key] = scrubUrl(v, opt.masked);
    } else if ((k === 'style' || k === '_csstext') && typeof v === 'string') {
      attrs[key] = scrubCss(v);
    } else if (opt.masked && TEXT_ATTRS.has(k) && typeof v === 'string') {
      attrs[key] = maskText(v);
    }
  }
  // Valores que no son lo que la persona escribe, pero suelen ser ids o tokens.
  if ((tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) || tag === 'option' || tag === 'button') delete attrs.value;
}

/** Un nodo del árbol de rrweb, con sus hijos. Lo que está en un campo editable o un select siempre va enmascarado. */
export function scrubNode(node: unknown, opt: ScrubOptions = { masked: true }, masked = false, depth = 0): void {
  if (!isObject(node) || depth > 2000) return;
  let inside = masked;
  if (node.type === NODE_ELEMENT) {
    const tag = String(node.tagName ?? '').toLowerCase();
    const attrs = isObject(node.attributes) ? node.attributes : null;
    if (tag === 'select' || tag === 'option') inside = true;
    if (attrs) {
      const editable = attrs.contenteditable;
      if (editable !== undefined && String(editable).toLowerCase() !== 'false') inside = true;
      scrubAttributes(attrs, tag, opt);
    }
  }
  if (node.type === NODE_TEXT && typeof node.textContent === 'string') {
    if (node.isStyle === true) node.textContent = scrubCss(node.textContent);
    else if (inside || opt.masked) node.textContent = maskText(node.textContent);
  }
  if (Array.isArray(node.childNodes)) for (const child of node.childNodes) scrubNode(child, opt, inside, depth + 1);
}

/** Limpia un evento de rrweb en el lugar. */
export function scrubReplayEvent(type: number, data: Rec, opt: ScrubOptions = { masked: true }): void {
  // Meta: la URL de la página.
  if (type === 4 && typeof data.href === 'string') data.href = scrubUrl(data.href, opt.masked);
  if (type === 2) scrubNode(data.node, opt);
  // Evento propio del snippet: un cambio de página en una app de una página.
  if (type === 5 && isObject(data.payload) && typeof data.payload.href === 'string') data.payload.href = scrubUrl(data.payload.href, opt.masked);
  if (type !== 3) return;
  // Mutación: nodos agregados, atributos y textos que cambian.
  if (data.source === 0) {
    if (Array.isArray(data.adds)) for (const add of data.adds) if (isObject(add)) scrubNode(add.node, opt);
    if (Array.isArray(data.attributes)) {
      for (const change of data.attributes) {
        if (!isObject(change) || !isObject(change.attributes)) continue;
        scrubAttributes(change.attributes, '', opt);
        // Sin saber qué elemento es, un valor que cambia por atributo no se guarda.
        delete change.attributes.value;
      }
    }
    if (opt.masked && Array.isArray(data.texts)) {
      for (const t of data.texts) if (isObject(t) && typeof t.value === 'string') t.value = maskText(t.value);
    }
  }
  // Entrada en un campo: siempre enmascarada.
  if (data.source === 5 && typeof data.text === 'string') data.text = maskText(data.text);
  // Reglas de estilo que se agregan después.
  if (data.source === 8 && Array.isArray(data.adds)) {
    for (const a of data.adds) if (isObject(a) && typeof a.rule === 'string') a.rule = scrubCss(a.rule);
  }
}
