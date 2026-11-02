/**
 * Limpieza de lo que trae una grabación antes de guardarla: lo mismo que la
 * ingesta de eventos saca de las URLs, más lo que el DOM guarda en atributos.
 * El snippet hace esta limpieza antes de mandar (public/zs.js); acá se repite
 * porque el pedido viene del navegador y puede venir de un snippet viejo.
 */
const SECRET_PARAM = /token|secret|password|passwd|auth|session|signature|sig$|code|key|otp|jwt|email/i;
/** Atributos con una URL. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'data', 'ping', 'background', 'longdesc', 'xlink:href']);
const NODE_ELEMENT = 2;
const NODE_TEXT = 3;

type Rec = Record<string, unknown>;
const isObject = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** URL (absoluta o relativa) sin fragmento ni parámetros que parezcan secretos. Conserva si era relativa. */
export function scrubUrl(raw: string): string {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return value ? '#' : value;
  if (/^(data|blob|mailto|tel):/i.test(value)) return /^(mailto|tel):/i.test(value) ? '' : value;
  if (/^javascript:/i.test(value)) return '';
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//');
  try {
    const u = new URL(value, 'https://zs.invalid');
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k) && !/^utm_/i.test(k)) u.searchParams.delete(k);
    return relative ? `${u.pathname}${u.search}` : u.toString();
  } catch {
    return '';
  }
}

function scrubAttributes(attrs: Rec, tag: string): void {
  const hidden = tag === 'input' && String(attrs.type ?? '').toLowerCase() === 'hidden';
  for (const key of Object.keys(attrs)) {
    const k = key.toLowerCase();
    if (k.startsWith('data-') || k === 'placeholder' || k === 'nonce' || k === 'integrity') delete attrs[key];
    else if (URL_ATTRS.has(k) && typeof attrs[key] === 'string') attrs[key] = scrubUrl(attrs[key] as string);
    else if (k === 'srcset') delete attrs[key];
  }
  if (hidden) delete attrs.value;
}

const maskText = (s: string) => s.replace(/\S/g, '*');

/** Un nodo del árbol de rrweb, con sus hijos. Lo que está en un campo editable o un select siempre va enmascarado. */
export function scrubNode(node: unknown, masked = false, depth = 0): void {
  if (!isObject(node) || depth > 2000) return;
  let inside = masked;
  if (node.type === NODE_ELEMENT) {
    const tag = String(node.tagName ?? '').toLowerCase();
    const attrs = isObject(node.attributes) ? node.attributes : null;
    if (attrs) {
      const editable = attrs.contenteditable;
      if ((editable !== undefined && String(editable).toLowerCase() !== 'false') || tag === 'select' || tag === 'option') inside = true;
      scrubAttributes(attrs, tag);
    } else if (tag === 'select' || tag === 'option') inside = true;
  }
  if (node.type === NODE_TEXT && inside && typeof node.textContent === 'string') node.textContent = maskText(node.textContent);
  if (Array.isArray(node.childNodes)) for (const child of node.childNodes) scrubNode(child, inside, depth + 1);
}

/** Limpia un evento de rrweb en el lugar. */
export function scrubReplayEvent(type: number, data: Rec): void {
  // Meta: la URL de la página.
  if (type === 4 && typeof data.href === 'string') data.href = scrubUrl(data.href);
  if (type === 2) scrubNode(data.node);
  // Incremental, mutación: nodos agregados y atributos que cambian.
  if (type === 3 && data.source === 0) {
    if (Array.isArray(data.adds)) {
      for (const add of data.adds) {
        if (isObject(add)) scrubNode(add.node);
      }
    }
    if (Array.isArray(data.attributes)) {
      for (const change of data.attributes) {
        if (!isObject(change) || !isObject(change.attributes)) continue;
        scrubAttributes(change.attributes, '');
        // Sin saber qué elemento es, un valor que cambia por atributo no se guarda.
        delete change.attributes.value;
      }
    }
  }
}
