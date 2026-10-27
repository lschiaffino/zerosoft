/**
 * Texto de un PDF, sin dependencias (para el conocimiento de Agents).
 *
 * Alcanza para los PDF que se generan desde Word, Google Docs, navegadores o
 * herramientas de facturación: lee los objetos (también los comprimidos en
 * object streams), sigue el árbol de páginas, infla los content streams
 * (FlateDecode) y junta el texto de los operadores Tj/TJ/'/" usando el
 * ToUnicode de cada fuente cuando lo tiene (si no, WinAnsi). No hace OCR: un
 * PDF escaneado no tiene texto y da `pdf_no_text`. Un PDF cifrado da
 * `pdf_encrypted`. Topes de tamaño en cada paso (nada de zip bombs).
 * Solo servidor (zlib).
 */
import { inflateSync } from 'zlib';

export class PdfTextError extends Error {
  constructor(public code: 'invalid_pdf' | 'pdf_encrypted' | 'pdf_no_text' | 'pdf_too_complex') {
    super(code);
  }
}

const MAX_INFLATED = 20 * 1024 * 1024;
/** Presupuesto por documento: bytes inflados en total, streams leídos y tiempo. */
const MAX_TOTAL_INFLATED = 50 * 1024 * 1024;
const MAX_STREAM_READS = 5000;
const MAX_CONTENT_REFS = 500;
const MAX_PAGES = 3000;
const MAX_MS = 8000;
const MAX_TEXT = 400_000;

type PdfValue = number | string | boolean | null | PdfName | PdfRef | PdfValue[] | PdfDict | PdfString;
interface PdfName {
  t: 'name';
  v: string;
}
interface PdfRef {
  t: 'ref';
  n: number;
}
interface PdfString {
  t: 'str';
  /** Bytes en latin1 (un char por byte). */
  v: string;
}
interface PdfDict {
  t: 'dict';
  v: Record<string, PdfValue>;
}

interface PdfObject {
  dict: PdfDict | null;
  value: PdfValue;
  stream: Buffer | null;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

/** Parser de valores PDF sobre un string latin1. */
class Lexer {
  pos = 0;
  constructor(public src: string) {}

  skipWs(): void {
    const s = this.src;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        // comentario
        while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++;
      } else break;
    }
  }

  regular(): string {
    const s = this.src;
    const start = this.pos;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (WS.has(c) || DELIM.has(c)) break;
      this.pos++;
    }
    return s.slice(start, this.pos);
  }

  literalString(): string {
    // Ya en '('.
    const s = this.src;
    this.pos++;
    let depth = 1;
    let out = '';
    while (this.pos < s.length) {
      const ch = s[this.pos++];
      if (ch === '\\') {
        const n = s[this.pos++];
        if (n === undefined) break;
        if (n === 'n') out += '\n';
        else if (n === 'r') out += '\r';
        else if (n === 't') out += '\t';
        else if (n === 'b') out += '\b';
        else if (n === 'f') out += '\f';
        else if (n === '\r') {
          if (s[this.pos] === '\n') this.pos++;
        } else if (n === '\n') {
          /* continuación de línea */
        } else if (n >= '0' && n <= '7') {
          let oct = n;
          for (let i = 0; i < 2 && s[this.pos] >= '0' && s[this.pos] <= '7'; i++) oct += s[this.pos++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else out += n;
      } else if (ch === '(') {
        depth++;
        out += ch;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
        out += ch;
      } else out += ch;
    }
    return out;
  }

  hexString(): string {
    // Ya en '<' (no '<<').
    const s = this.src;
    this.pos++;
    let hex = '';
    while (this.pos < s.length && s[this.pos] !== '>') {
      const ch = s[this.pos++];
      if (/[0-9a-fA-F]/.test(ch)) hex += ch;
    }
    this.pos++;
    if (hex.length % 2) hex += '0';
    let out = '';
    for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }

  /** Lee un valor; null si llega a un delimitador de cierre o al final. */
  value(depth = 0): PdfValue | undefined {
    if (depth > 50) throw new PdfTextError('invalid_pdf');
    this.skipWs();
    const s = this.src;
    if (this.pos >= s.length) return undefined;
    const ch = s[this.pos];
    if (ch === '/') {
      this.pos++;
      const raw = this.regular();
      return { t: 'name', v: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (ch === '(') return { t: 'str', v: this.literalString() };
    if (ch === '<') {
      if (s[this.pos + 1] === '<') {
        this.pos += 2;
        const dict: Record<string, PdfValue> = {};
        for (;;) {
          this.skipWs();
          if (s.startsWith('>>', this.pos)) {
            this.pos += 2;
            break;
          }
          const key = this.value(depth + 1);
          if (key === undefined) break;
          if (!key || typeof key !== 'object' || Array.isArray(key) || key.t !== 'name') continue;
          const v = this.value(depth + 1);
          if (v === undefined) break;
          dict[key.v] = v;
        }
        return { t: 'dict', v: dict };
      }
      return { t: 'str', v: this.hexString() };
    }
    if (ch === '[') {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (s[this.pos] === ']') {
          this.pos++;
          break;
        }
        const v = this.value(depth + 1);
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    if (ch === ']' || ch === '>' || ch === ')' || ch === '{' || ch === '}') {
      this.pos++;
      return null;
    }
    const word = this.regular();
    if (!word) {
      this.pos++;
      return null;
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      // ¿Es una referencia "n g R"?
      const save = this.pos;
      const m = /^\s+(\d+)\s+R(?=[\s/<>[\]()%]|$)/.exec(s.slice(this.pos, this.pos + 24));
      if (m && /^\d+$/.test(word)) {
        this.pos = save + m[0].length;
        return { t: 'ref', n: Number(word) };
      }
      return Number(word);
    }
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return { t: 'name', v: word };
  }
}

function isDict(v: PdfValue | undefined): v is PdfDict {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v) && (v as PdfDict).t === 'dict');
}
function isRef(v: PdfValue | undefined): v is PdfRef {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v) && (v as PdfRef).t === 'ref');
}
function nameOf(v: PdfValue | undefined): string | null {
  return v && typeof v === 'object' && !Array.isArray(v) && (v as PdfName).t === 'name' ? (v as PdfName).v : null;
}

/**
 * Presupuesto compartido por todo el documento: un PDF chico que referencia
 * 300 veces un stream que infla a 20 MB (o anida object streams) no puede
 * comerse la memoria ni la CPU. Pasado el tope: pdf_too_complex.
 */
class Budget {
  inflated = 0;
  reads = 0;
  readonly deadline = Date.now() + MAX_MS;
  check(): void {
    if (Date.now() > this.deadline || this.reads > MAX_STREAM_READS) throw new PdfTextError('pdf_too_complex');
  }
  room(): number {
    const left = MAX_TOTAL_INFLATED - this.inflated;
    if (left <= 0) throw new PdfTextError('pdf_too_complex');
    return Math.min(MAX_INFLATED, left);
  }
}

function inflate(buf: Buffer, budget: Budget): Buffer {
  const max = budget.room();
  let out: Buffer;
  try {
    out = inflateSync(buf, { maxOutputLength: max });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new PdfTextError('pdf_too_complex');
    // Streams con basura al final: inflar lo que se pueda.
    try {
      out = inflateSync(buf, { maxOutputLength: max, finishFlush: 2 /* Z_SYNC_FLUSH */ });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new PdfTextError('pdf_too_complex');
      out = Buffer.alloc(0);
    }
  }
  budget.inflated += out.length;
  return out;
}

function decodeStream(dict: PdfDict | null, raw: Buffer, budget: Budget): Buffer | null {
  budget.reads++;
  budget.check();
  const filter = dict?.v.Filter;
  const filters = Array.isArray(filter) ? filter.map(nameOf) : filter ? [nameOf(filter)] : [];
  if (filters.length > 4) return null;
  let out = raw;
  for (const f of filters) {
    if (f === 'FlateDecode' || f === 'Fl') out = inflate(out, budget);
    else if (f === 'ASCIIHexDecode' || f === 'AHx') out = Buffer.from(out.toString('latin1').replace(/[^0-9a-fA-F]/g, ''), 'hex');
    else return null; // LZW, DCT, etc.: no es texto que podamos leer.
  }
  return out;
}

class PdfDoc {
  objects = new Map<number, PdfObject>();
  readonly budget = new Budget();
  /** Streams ya inflados, por número de objeto (un stream referenciado N veces se infla una). */
  private decoded = new Map<number, Buffer | null>();

  constructor(private buf: Buffer) {
    const src = buf.toString('latin1');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const num = Number(m[1]);
      const lex = new Lexer(src);
      lex.pos = m.index + m[0].length;
      let value: PdfValue | undefined;
      try {
        value = lex.value();
      } catch {
        continue;
      }
      if (value === undefined) continue;
      let stream: Buffer | null = null;
      lex.skipWs();
      if (src.startsWith('stream', lex.pos)) {
        let start = lex.pos + 6;
        if (src[start] === '\r') start++;
        if (src[start] === '\n') start++;
        const len = isDict(value) ? value.v.Length : undefined;
        let end = typeof len === 'number' && start + len <= src.length && src.slice(start + len, start + len + 12).includes('endstream') ? start + len : -1;
        if (end < 0) {
          end = src.indexOf('endstream', start);
          if (end < 0) end = src.length;
          while (end > start && (src[end - 1] === '\n' || src[end - 1] === '\r')) end--;
        }
        stream = buf.subarray(start, end);
        re.lastIndex = end;
      }
      // Revisiones incrementales: gana la última aparición.
      this.objects.set(num, { dict: isDict(value) ? value : null, value, stream });
    }
    // Object streams (PDF 1.5+): los objetos chicos (páginas, fuentes) viven ahí.
    for (const obj of [...this.objects.values()]) {
      if (nameOf(obj.dict?.v.Type) !== 'ObjStm' || !obj.stream) continue;
      const data = decodeStream(obj.dict, obj.stream, this.budget);
      if (!data) continue;
      const text = data.toString('latin1');
      const n = Number(obj.dict?.v.N ?? 0);
      const first = Number(obj.dict?.v.First ?? 0);
      const head = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < head.length && i / 2 < n; i += 2) {
        const num = head[i];
        if (this.objects.has(num) && this.objects.get(num)!.stream) continue;
        const lex = new Lexer(text);
        lex.pos = first + head[i + 1];
        try {
          const value = lex.value();
          if (value !== undefined && !this.objects.has(num)) this.objects.set(num, { dict: isDict(value) ? value : null, value, stream: null });
        } catch {
          /* objeto roto: se saltea */
        }
      }
    }
  }

  resolve(v: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (isRef(v) && depth < 10) return this.resolve(this.objects.get(v.n)?.value, depth + 1);
    return v;
  }

  streamOf(v: PdfValue | undefined): Buffer | null {
    if (!isRef(v)) return null;
    if (this.decoded.has(v.n)) return this.decoded.get(v.n)!;
    const obj = this.objects.get(v.n);
    if (!obj?.stream) return null;
    const data = decodeStream(obj.dict, obj.stream, this.budget);
    this.decoded.set(v.n, data);
    return data;
  }

  get encrypted(): boolean {
    return /\/Encrypt\s/.test(this.buf.subarray(Math.max(0, this.buf.length - 4096)).toString('latin1')) || [...this.objects.values()].some((o) => nameOf(o.dict?.v.Type) === 'XRef' && o.dict?.v.Encrypt !== undefined);
  }

  /** Páginas en orden (árbol /Pages); si no hay árbol, en orden de objeto. */
  pages(): PdfDict[] {
    const out: PdfDict[] = [];
    const seen = new Set<PdfDict>();
    const walk = (node: PdfValue | undefined, inherited: PdfValue | undefined, depth: number) => {
      const d = this.resolve(node);
      if (!isDict(d) || seen.has(d) || depth > 30) return;
      seen.add(d);
      const res = d.v.Resources ?? inherited;
      const type = nameOf(d.v.Type);
      if (type === 'Pages' || Array.isArray(this.resolve(d.v.Kids))) {
        const kids = this.resolve(d.v.Kids);
        if (Array.isArray(kids)) for (const k of kids) walk(k, res, depth + 1);
      } else if (type === 'Page' || d.v.Contents !== undefined) {
        out.push(res !== undefined && d.v.Resources === undefined ? { t: 'dict', v: { ...d.v, Resources: res } } : d);
      }
    };
    const catalog = [...this.objects.values()].find((o) => nameOf(o.dict?.v.Type) === 'Catalog');
    if (catalog?.dict) walk(catalog.dict.v.Pages, undefined, 0);
    if (out.length) return out;
    return [...this.objects.values()].filter((o) => nameOf(o.dict?.v.Type) === 'Page' && o.dict).map((o) => o.dict!);
  }
}

// ---------- Fuentes ----------

interface FontMap {
  /** Bytes por código (1 o 2), según el codespace del CMap. */
  bytes: number;
  map: Map<number, string> | null;
}

function utf16be(bytes: string): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
  if (bytes.length % 2) out += bytes[bytes.length - 1];
  return out;
}

const hexToBytes = (h: string) => {
  let out = '';
  for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return out;
};
const hexToNum = (h: string) => parseInt(h || '0', 16);

/** CMap ToUnicode → mapa código → texto. Exportada para tests. */
export function parseToUnicode(cmap: string): FontMap {
  const map = new Map<number, string>();
  let bytes = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap);
  if (cs) {
    const m = /<([0-9a-fA-F]+)>/.exec(cs[1]);
    if (m) bytes = Math.max(1, Math.min(4, Math.ceil(m[1].length / 2)));
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(hexToNum(m[1]), utf16be(hexToBytes(m[2])));
      if (!cs) bytes = Math.max(bytes, Math.ceil(m[1].length / 2));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hexToNum(m[1]);
      const hi = Math.min(hexToNum(m[2]), lo + 65_535);
      if (!cs) bytes = Math.max(bytes, Math.ceil(m[1].length / 2));
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => utf16be(hexToBytes(x[1])));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
      } else {
        const dst = hexToBytes(m[3].slice(1, -1));
        const base = utf16be(dst);
        if (!base) continue;
        const last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return { bytes, map };
}

// WinAnsi: los 32 códigos 0x80–0x9F que no coinciden con latin1.
const WIN_ANSI: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ',
  0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodeText(bytes: string, font: FontMap | undefined): string {
  if (font?.map) {
    let out = '';
    for (let i = 0; i + font.bytes <= bytes.length; i += font.bytes) {
      let code = 0;
      for (let j = 0; j < font.bytes; j++) code = (code << 8) | bytes.charCodeAt(i + j);
      out += font.map.get(code) ?? '';
    }
    return out;
  }
  if (font && font.bytes === 2) return ''; // fuente CID sin ToUnicode: ilegible.
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes.charCodeAt(i);
    out += WIN_ANSI[c] ?? (c >= 32 ? String.fromCharCode(c) : c === 9 ? ' ' : '');
  }
  return out;
}

function fontsOf(doc: PdfDoc, page: PdfDict, cache: Map<number, FontMap>): Map<string, FontMap> {
  const out = new Map<string, FontMap>();
  const res = doc.resolve(page.v.Resources);
  if (!isDict(res)) return out;
  const fonts = doc.resolve(res.v.Font);
  if (!isDict(fonts)) return out;
  for (const [name, ref] of Object.entries(fonts.v)) {
    const key = isRef(ref) ? ref.n : -1;
    if (key >= 0 && cache.has(key)) {
      out.set(name, cache.get(key)!);
      continue;
    }
    const font = doc.resolve(ref);
    let fm: FontMap = { bytes: 1, map: null };
    if (isDict(font)) {
      const cmap = doc.streamOf(font.v.ToUnicode);
      if (cmap) fm = parseToUnicode(cmap.toString('latin1'));
      else if (nameOf(font.v.Subtype) === 'Type0') fm = { bytes: 2, map: null };
    }
    if (key >= 0) cache.set(key, fm);
    out.set(name, fm);
  }
  return out;
}

/** Texto de un content stream. Exportada para tests. */
export function contentStreamText(content: string, fonts: Map<string, FontMap> = new Map(), deadline = Infinity): string {
  const lex = new Lexer(content);
  const stack: PdfValue[] = [];
  let font: FontMap | undefined;
  let out = '';
  let lastY: number | null = null;
  const push = (t: string) => {
    if (t) out += t;
  };
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  for (let guard = 0; guard < 2_000_000; guard++) {
    if ((guard & 4095) === 0 && Date.now() > deadline) throw new PdfTextError('pdf_too_complex');
    lex.skipWs();
    if (lex.pos >= content.length) break;
    const ch = content[lex.pos];
    // Imagen en línea: BI … ID <bytes> EI.
    if (content.startsWith('BI', lex.pos) && /[\s]/.test(content[lex.pos + 2] ?? ' ')) {
      const end = content.indexOf('EI', lex.pos + 2);
      lex.pos = end < 0 ? content.length : end + 2;
      stack.length = 0;
      continue;
    }
    if (ch === '/' || ch === '(' || ch === '<' || ch === '[' || /[0-9+.-]/.test(ch)) {
      const v = lex.value();
      if (v === undefined) break;
      stack.push(v);
      if (stack.length > 64) stack.shift();
      continue;
    }
    const op = lex.regular();
    if (!op) {
      lex.pos++;
      continue;
    }
    const str = (v: PdfValue | undefined) => (v && typeof v === 'object' && !Array.isArray(v) && (v as PdfString).t === 'str' ? (v as PdfString).v : null);
    switch (op) {
      case 'Tf': {
        const name = nameOf(stack[stack.length - 2]);
        font = name ? fonts.get(name) : undefined;
        break;
      }
      case 'Tj': {
        const s = str(stack[stack.length - 1]);
        if (s !== null) push(decodeText(s, font));
        break;
      }
      case "'":
      case '"': {
        newline();
        const s = str(stack[stack.length - 1]);
        if (s !== null) push(decodeText(s, font));
        break;
      }
      case 'TJ': {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            const s = str(item);
            if (s !== null) push(decodeText(s, font));
            // Un espaciado grande (en milésimas de em) es un espacio entre palabras.
            else if (typeof item === 'number' && item < -180 && !out.endsWith(' ')) push(' ');
          }
        }
        break;
      }
      case 'T*':
        newline();
        break;
      case 'Td':
      case 'TD': {
        const ty = stack[stack.length - 1];
        if (typeof ty === 'number' && Math.abs(ty) > 0.5) newline();
        else if (!out.endsWith(' ') && !out.endsWith('\n') && out) push(' ');
        break;
      }
      case 'Tm': {
        const y = stack[stack.length - 1];
        if (typeof y === 'number') {
          if (lastY !== null && Math.abs(y - lastY) > 0.5) newline();
          else if (lastY !== null && out && !out.endsWith(' ') && !out.endsWith('\n')) push(' ');
          lastY = y;
        }
        break;
      }
      case 'ET':
        if (!out.endsWith(' ') && !out.endsWith('\n') && out) push(' ');
        break;
      default:
        break;
    }
    stack.length = 0;
    if (out.length > MAX_TEXT) break;
  }
  return out;
}

/** Texto plano de un PDF (páginas separadas por una línea en blanco). */
export function pdfToText(input: ArrayBuffer | Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new PdfTextError('invalid_pdf');
  const doc = new PdfDoc(buf);
  if (doc.encrypted) throw new PdfTextError('pdf_encrypted');
  const cache = new Map<number, FontMap>();
  const parts: string[] = [];
  let total = 0;
  // Cada content stream se lee una vez aunque varias páginas (o la misma) lo repitan.
  const seen = new Set<number>();
  for (const page of doc.pages().slice(0, MAX_PAGES)) {
    doc.budget.check();
    const fonts = fontsOf(doc, page, cache);
    const contents = doc.resolve(page.v.Contents);
    const refs = (Array.isArray(contents) ? contents : [page.v.Contents]).slice(0, MAX_CONTENT_REFS);
    let text = '';
    for (const ref of refs) {
      if (!isRef(ref as PdfValue) || seen.has((ref as PdfRef).n)) continue;
      seen.add((ref as PdfRef).n);
      const data = doc.streamOf(ref as PdfValue);
      if (data) text += contentStreamText(data.toString('latin1'), fonts, doc.budget.deadline) + '\n';
      doc.budget.check();
    }
    const clean = text
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (clean) parts.push(clean);
    total += clean.length;
    if (total > MAX_TEXT) break;
  }
  const out = parts.join('\n\n').slice(0, MAX_TEXT);
  if (out.replace(/\s/g, '').length < 10) throw new PdfTextError('pdf_no_text');
  return out;
}
