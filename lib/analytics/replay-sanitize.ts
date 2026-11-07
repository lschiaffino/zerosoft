/**
 * Lo que recibe el reproductor: una grabación la manda el navegador del sitio y
 * puede apuntar a cualquier URL. Quien la mira no le pide nada a nadie: se sacan
 * las URLs externas de imágenes, estilos, fuentes y medios antes de reconstruir
 * la página, también al entrar por navegación del lado del cliente, donde el
 * encabezado de la página no vuelve a aplicarse. Las imágenes del sitio se ven
 * como un hueco.
 */
const EXTERNAL = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const SAFE = /^\s*(?:data:|blob:|#)/i;
const FETCHING_ATTRS = new Set(['src', 'srcset', 'poster', 'background', 'data', 'longdesc', 'xlink:href', 'ping', 'action', 'formaction', 'cite', 'imagesrcset']);
type Rec = Record<string, unknown>;
const isObject = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** CSS sin nada que salga a buscar afuera. */
export function neutralizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, _q: string, url: string) => (/^\s*data:/i.test(url) ? m : 'none'))
    .replace(/image-set\([^)]*\)/gi, 'none');
}

function cleanAttrs(attrs: Rec, tag: string): void {
  for (const key of Object.keys(attrs)) {
    const k = key.toLowerCase();
    const v = attrs[key];
    if (typeof v !== 'string') continue;
    if (k === 'style' || k === '_csstext') attrs[key] = neutralizeCss(v);
    else if (k === 'href') {
      // Un link común no pide nada hasta el clic, y el reproductor no navega. <link>, <image> y demás sí piden.
      if (tag !== 'a' && !SAFE.test(v)) delete attrs[key];
    } else if (FETCHING_ATTRS.has(k) && !SAFE.test(v)) delete attrs[key];
    else if (k === 'http-equiv') delete attrs[key];
  }
}

function cleanNode(node: unknown, depth = 0): void {
  if (!isObject(node) || depth > 2000) return;
  if (node.type === 2 && isObject(node.attributes)) cleanAttrs(node.attributes, String(node.tagName ?? '').toLowerCase());
  if (node.type === 3 && node.isStyle === true && typeof node.textContent === 'string') node.textContent = neutralizeCss(node.textContent);
  if (Array.isArray(node.childNodes)) for (const c of node.childNodes) cleanNode(c, depth + 1);
}

/** Texto de CSS en cualquier parte del evento (reglas agregadas, hojas adoptadas, declaraciones). */
function cleanStrings(v: unknown, depth = 0): unknown {
  if (depth > 12) return v;
  if (typeof v === 'string') return /url\(|@import|image-set/i.test(v) ? neutralizeCss(v) : v;
  if (Array.isArray(v)) return v.map((x) => cleanStrings(x, depth + 1));
  if (isObject(v)) {
    for (const k of Object.keys(v)) v[k] = cleanStrings(v[k], depth + 1);
    return v;
  }
  return v;
}

/** Devuelve los eventos listos para reconstruir, sin las fuentes externas. */
export function sanitizeForPlayer<T extends { type?: unknown; data?: unknown }>(events: T[]): T[] {
  const out: T[] = [];
  for (const e of events) {
    const data = isObject(e.data) ? e.data : null;
    if (!data) {
      out.push(e);
      continue;
    }
    if (e.type === 2) cleanNode(data.node);
    if (e.type === 3) {
      // Fuente: rrweb la baja de la URL que dice el evento.
      if (data.source === 7) continue;
      if (data.source === 0) {
        if (Array.isArray(data.adds)) for (const a of data.adds) if (isObject(a)) cleanNode(a.node);
        if (Array.isArray(data.attributes)) {
          for (const c of data.attributes) if (isObject(c) && isObject(c.attributes)) cleanAttrs(c.attributes, '');
        }
      } else if (data.source === 8 || data.source === 13 || data.source === 15) {
        cleanStrings(data);
      }
    }
    out.push(e);
  }
  return out;
}

export { EXTERNAL as EXTERNAL_URL };
