/**
 * Parser XML mínimo y seguro para importar (ENEX de Evernote y su ENML).
 *
 * Seguridad: nunca resuelve entidades externas ni definidas en un DOCTYPE
 * (el DOCTYPE se saltea entero, con su subset interno), así que no hay XXE
 * ni "billion laughs". Solo decodifica las 5 entidades de XML, referencias
 * numéricas y unas pocas de HTML que usa el ENML (&nbsp; …); cualquier otra
 * queda como texto literal. Recorre el texto carácter por carácter (sin
 * regex sobre la estructura) y corta con XmlLimitError si se pasa de
 * profundidad, cantidad de nodos o tamaño.
 *
 * Es tolerante como un navegador: un cierre que no coincide cierra hasta el
 * ancestro que corresponde y uno huérfano se ignora.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlLimitError extends Error {
  constructor(public code: 'too_deep' | 'too_many_nodes' | 'too_large') {
    super(code);
  }
}

export interface XmlLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxLength?: number;
}

const NAMED: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
};

function isNameChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    c === '-' ||
    c === '_' ||
    c === ':' ||
    c === '.' ||
    code > 127
  );
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r';
}

/** Decodifica entidades sin expandir nada que no sea conocido. */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== '&') {
      out += c;
      i++;
      continue;
    }
    const end = text.indexOf(';', i + 1);
    if (end === -1 || end - i > 12) {
      out += c;
      i++;
      continue;
    }
    const ref = text.slice(i + 1, end);
    let decoded: string | null = null;
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const n = parseInt(ref.slice(2), 16);
      decoded = Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
    } else if (ref.startsWith('#')) {
      const n = parseInt(ref.slice(1), 10);
      decoded = Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
    } else {
      decoded = Object.prototype.hasOwnProperty.call(NAMED, ref) ? NAMED[ref] : null;
    }
    if (decoded === null) {
      out += c;
      i++;
      continue;
    }
    out += decoded;
    i = end + 1;
  }
  return out;
}

/** Saltea un `<!DOCTYPE …>` con subset interno `[ … ]`; devuelve el índice después del `>`. */
function skipDoctype(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

/**
 * Parsea y devuelve un elemento raíz sintético (`#document`) con los nodos
 * de primer nivel. Los nombres quedan en minúsculas.
 */
export function parseXml(src: string, limits: XmlLimits = {}): XmlElement {
  const maxDepth = limits.maxDepth ?? 256;
  const maxNodes = limits.maxNodes ?? 500_000;
  const maxLength = limits.maxLength ?? 64 * 1024 * 1024;
  if (src.length > maxLength) throw new XmlLimitError('too_large');

  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let nodes = 0;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const pushText = (raw: string, decode: boolean) => {
    if (!raw) return;
    const text = decode ? decodeXmlEntities(raw) : raw;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (typeof last === 'string') kids[kids.length - 1] = last + text;
    else {
      if (++nodes > maxNodes) throw new XmlLimitError('too_many_nodes');
      kids.push(text);
    }
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      pushText(src.slice(i), true);
      break;
    }
    if (lt > i) pushText(src.slice(i, lt), true);
    i = lt;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      pushText(src.slice(i + 9, end === -1 ? src.length : end), false);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('<!', i)) {
      // DOCTYPE (o cualquier otra declaración): se descarta sin interpretarla.
      i = skipDoctype(src, i + 2);
      continue;
    }

    // Cierre </name>
    if (src[i + 1] === '/') {
      let j = i + 2;
      while (j < src.length && isNameChar(src[j])) j++;
      const name = src.slice(i + 2, j).toLowerCase();
      const gt = src.indexOf('>', j);
      i = gt === -1 ? src.length : gt + 1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    // Apertura <name attr="v" …> o <name/>
    let j = i + 1;
    while (j < src.length && isNameChar(src[j])) j++;
    const name = src.slice(i + 1, j).toLowerCase();
    if (!name) {
      // "<" suelto: es texto.
      pushText('<', false);
      i++;
      continue;
    }
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (j < src.length) {
      while (isSpace(src[j])) j++;
      const c = src[j];
      if (c === undefined) break;
      if (c === '>') {
        j++;
        break;
      }
      if (c === '/' && src[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      let k = j;
      while (k < src.length && isNameChar(src[k])) k++;
      if (k === j) {
        j++; // carácter inesperado: se saltea
        continue;
      }
      const attr = src.slice(j, k).toLowerCase();
      j = k;
      while (isSpace(src[j])) j++;
      let value = '';
      if (src[j] === '=') {
        j++;
        while (isSpace(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          value = src.slice(j + 1, end === -1 ? src.length : end);
          j = end === -1 ? src.length : end + 1;
        } else {
          let e = j;
          while (e < src.length && !isSpace(src[e]) && src[e] !== '>') e++;
          value = src.slice(j, e);
          j = e;
        }
      }
      if (!Object.prototype.hasOwnProperty.call(attrs, attr)) attrs[attr] = decodeXmlEntities(value);
    }
    i = j;
    if (++nodes > maxNodes) throw new XmlLimitError('too_many_nodes');
    const el: XmlElement = { name, attrs, children: [] };
    top().children.push(el);
    // Elementos vacíos de HTML que el ENML a veces trae sin "/".
    const voidEl = name === 'br' || name === 'hr' || name === 'img' || name === 'en-media' || name === 'en-todo';
    if (!selfClosing && !voidEl) {
      if (stack.length > maxDepth) throw new XmlLimitError('too_deep');
      stack.push(el);
    }
  }
  return root;
}

// ---------- Helpers de lectura ----------

export function isElement(node: XmlNode | undefined): node is XmlElement {
  return typeof node === 'object' && node !== null;
}

/** Hijos directos con ese nombre. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => isElement(c) && (!name || c.name === name));
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

/** Primer descendiente con ese nombre (en profundidad, sin recursión). */
export function findElement(el: XmlElement, name: string): XmlElement | undefined {
  const queue: XmlElement[] = [el];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (cur !== el && cur.name === name) return cur;
    for (const c of cur.children) if (isElement(c)) queue.push(c);
  }
  return undefined;
}

/** Texto de un elemento y sus descendientes. */
export function textContent(node: XmlNode | undefined): string {
  if (node === undefined) return '';
  if (typeof node === 'string') return node;
  let out = '';
  const stack: XmlNode[] = [...node.children].reverse();
  while (stack.length) {
    const cur = stack.pop()!;
    if (typeof cur === 'string') out += cur;
    else for (let k = cur.children.length - 1; k >= 0; k--) stack.push(cur.children[k]);
  }
  return out;
}
