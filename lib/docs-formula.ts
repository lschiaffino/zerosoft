/**
 * Fórmulas de las bases de Docs (propiedad `formula`), con la sintaxis de
 * Notion: `prop("Precio") * prop("Cantidad")`, `if(prop("Hecho"), "✓", "")`,
 * `dateBetween(prop("Fin"), now(), "days")`, `prop("Nombre").length()`.
 *
 * Puro (sin DB ni DOM): parser de precedencia, evaluador con tope de pasos
 * y funciones comunes de texto, números, fechas, lógica y listas. Las
 * propiedades se leen con un callback (`getProp`), así el que llama decide
 * cómo se ve cada tipo (opciones por nombre, relaciones como títulos, etc.).
 */

export type FValue = number | string | boolean | null | FDate | FValue[];

/** Fecha de una fórmula: instante en ms y si es solo día (sin hora). */
export class FDate {
  constructor(
    public readonly t: number,
    public readonly dateOnly: boolean,
  ) {}
}

export class FormulaError extends Error {}

/** Tipo del resultado (para mostrar, filtrar y ordenar). */
export type FKind = 'number' | 'text' | 'checkbox' | 'date';

// ---------- Tokens ----------

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'end' };

const OPS = ['==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '%', '^', '>', '<', '!', '?', ':', '(', ')', ',', '.', '[', ']', '='];

export const FORMULA_MAX_LENGTH = 4000;

function tokenize(src: string): Tok[] {
  if (src.length > FORMULA_MAX_LENGTH) throw new FormulaError('too_long');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (/[0-9]/.test(src[k] ?? '')) {
          j = k;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
      }
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new FormulaError('bad_number');
      out.push({ k: 'num', v: n });
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '“' || c === '”') {
      const close = c === '“' ? '”' : c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== close && !(close === '”' && src[j] === '"')) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
          continue;
        }
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new FormulaError('unterminated_string');
      out.push({ k: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_$]/u.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`unexpected:${c}`);
    out.push({ k: 'op', v: op });
    i += op.length;
  }
  out.push({ k: 'end' });
  return out;
}

// ---------- AST ----------

export type FNode =
  | { t: 'lit'; v: FValue }
  | { t: 'prop'; name: string }
  | { t: 'call'; name: string; args: FNode[] }
  | { t: 'list'; items: FNode[] }
  | { t: 'un'; op: string; a: FNode }
  | { t: 'bin'; op: string; a: FNode; b: FNode }
  | { t: 'cond'; c: FNode; a: FNode; b: FNode }
  | { t: 'index'; a: FNode; i: FNode };

class Parser {
  private i = 0;
  constructor(
    private toks: Tok[],
    private propNames: Set<string>,
  ) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }
  private isWord(v: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v.toLowerCase() === v;
  }
  private expect(v: string): void {
    if (!this.isOp(v)) throw new FormulaError(`expected:${v}`);
    this.i++;
  }

  parse(): FNode {
    const n = this.ternary();
    if (this.peek().k !== 'end') throw new FormulaError('unexpected_token');
    return n;
  }

  private ternary(): FNode {
    const c = this.or();
    if (this.isOp('?')) {
      this.i++;
      const a = this.ternary();
      this.expect(':');
      const b = this.ternary();
      return { t: 'cond', c, a, b };
    }
    return c;
  }
  private or(): FNode {
    let a = this.and();
    while (this.isOp('||') || this.isWord('or')) {
      this.i++;
      a = { t: 'bin', op: '||', a, b: this.and() };
    }
    return a;
  }
  private and(): FNode {
    let a = this.eq();
    while (this.isOp('&&') || this.isWord('and')) {
      this.i++;
      a = { t: 'bin', op: '&&', a, b: this.eq() };
    }
    return a;
  }
  private eq(): FNode {
    let a = this.cmp();
    while (this.isOp('==') || this.isOp('!=') || this.isOp('=')) {
      const op = this.next() as { v: string };
      a = { t: 'bin', op: op.v === '=' ? '==' : op.v, a, b: this.cmp() };
    }
    return a;
  }
  private cmp(): FNode {
    let a = this.add();
    while (this.isOp('>') || this.isOp('<') || this.isOp('>=') || this.isOp('<=')) {
      const op = (this.next() as { v: string }).v;
      a = { t: 'bin', op, a, b: this.add() };
    }
    return a;
  }
  private add(): FNode {
    let a = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v;
      a = { t: 'bin', op, a, b: this.mul() };
    }
    return a;
  }
  private mul(): FNode {
    let a = this.pow();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.next() as { v: string }).v;
      a = { t: 'bin', op, a, b: this.pow() };
    }
    return a;
  }
  private pow(): FNode {
    const a = this.unary();
    if (this.isOp('^')) {
      this.i++;
      return { t: 'bin', op: '^', a, b: this.pow() };
    }
    return a;
  }
  private unary(): FNode {
    if (this.isOp('-')) {
      this.i++;
      return { t: 'un', op: '-', a: this.unary() };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    if (this.isOp('!') || this.isWord('not')) {
      // `not(x)` también es una función: si sigue "(", queda como llamada.
      if (this.isWord('not') && this.toks[this.i + 1]?.k === 'op' && (this.toks[this.i + 1] as { v: string }).v === '(') return this.postfix();
      this.i++;
      return { t: 'un', op: '!', a: this.unary() };
    }
    return this.postfix();
  }
  private args(): FNode[] {
    this.expect('(');
    const out: FNode[] = [];
    if (this.isOp(')')) {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.ternary());
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      this.expect(')');
      return out;
    }
  }
  private postfix(): FNode {
    let n = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.i++;
        const id = this.next();
        if (id.k !== 'id') throw new FormulaError('expected_function');
        const args = this.isOp('(') ? this.args() : [];
        n = { t: 'call', name: id.v, args: [n, ...args] };
        continue;
      }
      if (this.isOp('[')) {
        this.i++;
        const i = this.ternary();
        this.expect(']');
        n = { t: 'index', a: n, i };
        continue;
      }
      return n;
    }
  }
  private primary(): FNode {
    const tok = this.next();
    if (tok.k === 'num') return { t: 'lit', v: tok.v };
    if (tok.k === 'str') return { t: 'lit', v: tok.v };
    if (tok.k === 'op' && tok.v === '(') {
      const n = this.ternary();
      this.expect(')');
      return n;
    }
    if (tok.k === 'op' && tok.v === '[') {
      const items: FNode[] = [];
      if (this.isOp(']')) {
        this.i++;
        return { t: 'list', items };
      }
      for (;;) {
        items.push(this.ternary());
        if (this.isOp(',')) {
          this.i++;
          continue;
        }
        this.expect(']');
        return { t: 'list', items };
      }
    }
    if (tok.k === 'id') {
      const lower = tok.v.toLowerCase();
      if (this.isOp('(')) {
        const args = this.args();
        if (lower === 'prop') {
          const a = args[0];
          if (args.length !== 1 || !a || a.t !== 'lit' || typeof a.v !== 'string') throw new FormulaError('prop_needs_name');
          return { t: 'prop', name: a.v };
        }
        if (!FUNCTIONS[lower]) throw new FormulaError(`unknown_function:${tok.v}`);
        return { t: 'call', name: lower, args };
      }
      if (lower === 'true') return { t: 'lit', v: true };
      if (lower === 'false') return { t: 'lit', v: false };
      if (this.propNames.has(tok.v)) return { t: 'prop', name: tok.v };
      if (FUNCTIONS[lower] && FUNCTIONS[lower].length === 0) return { t: 'call', name: lower, args: [] };
      throw new FormulaError(`unknown_name:${tok.v}`);
    }
    throw new FormulaError('unexpected_token');
  }
}

const parsed = new Map<string, FNode | FormulaError>();

/** AST de una fórmula (cacheado por texto + nombres de propiedad). */
export function parseFormula(src: string, propNames: Iterable<string> = []): FNode {
  const names = new Set(propNames);
  const key = `${[...names].join('\u0001')}\u0000${src}`;
  const hit = parsed.get(key);
  if (hit instanceof FormulaError) throw hit;
  if (hit) return hit;
  let out: FNode | FormulaError;
  try {
    out = new Parser(tokenize(src), names).parse();
  } catch (e) {
    out = e instanceof FormulaError ? e : new FormulaError('parse_error');
  }
  if (parsed.size > 2000) parsed.clear();
  parsed.set(key, out);
  if (out instanceof FormulaError) throw out;
  return out;
}

/** Nombres de propiedad que usa una fórmula (para detectar ciclos y avisar en el editor). */
export function formulaProps(node: FNode): string[] {
  const out = new Set<string>();
  const walk = (n: FNode) => {
    switch (n.t) {
      case 'prop':
        out.add(n.name);
        return;
      case 'call':
        n.args.forEach(walk);
        return;
      case 'list':
        n.items.forEach(walk);
        return;
      case 'un':
        walk(n.a);
        return;
      case 'bin':
        walk(n.a);
        walk(n.b);
        return;
      case 'cond':
        walk(n.c);
        walk(n.a);
        walk(n.b);
        return;
      case 'index':
        walk(n.a);
        walk(n.i);
        return;
      default:
        return;
    }
  };
  walk(node);
  return [...out];
}

// ---------- Conversión ----------

const DAY = 86_400_000;

export function toNum(v: FValue): number {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof FDate) return v.t;
  if (Array.isArray(v)) return v.length ? toNum(v[0]) : 0;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateKeyOf(d: FDate): string {
  const x = new Date(d.t);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function toText(v: FValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof FDate) {
    if (v.dateOnly) return dateKeyOf(v);
    const x = new Date(v.t);
    return `${dateKeyOf(v)} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
  }
  return v.map(toText).join(', ');
}

export function toBool(v: FValue): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'false';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Fecha desde 'YYYY-MM-DD' (local) o un ISO con hora. */
export function parseFDate(v: unknown): FDate | null {
  if (v instanceof FDate) return v;
  if (typeof v !== 'string' || !v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new FDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime(), true);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new FDate(t, false);
}

function toDate(v: FValue): FDate | null {
  if (v instanceof FDate) return v;
  if (typeof v === 'number') return new FDate(v, false);
  if (typeof v === 'string') return parseFDate(v.trim());
  return null;
}

function isEmpty(v: FValue): boolean {
  if (v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  return false;
}

function equals(a: FValue, b: FValue): boolean {
  if (a instanceof FDate || b instanceof FDate) {
    const da = toDate(a);
    const db = toDate(b);
    return !!da && !!db && da.t === db.t;
  }
  if (Array.isArray(a) || Array.isArray(b)) return toText(a) === toText(b);
  if (typeof a === 'number' || typeof b === 'number') {
    if (a === null || b === null) return a === b;
    return toNum(a) === toNum(b);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b);
  return toText(a) === toText(b);
}

function compare(a: FValue, b: FValue): number {
  if (a instanceof FDate || b instanceof FDate) return (toDate(a)?.t ?? 0) - (toDate(b)?.t ?? 0);
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return toNum(a) - toNum(b);
}

// ---------- Fechas ----------

type Unit = 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds';

function unitOf(v: FValue): Unit {
  const u = toText(v).toLowerCase().trim().replace(/s$/, '');
  const map: Record<string, Unit> = {
    year: 'years',
    quarter: 'quarters',
    month: 'months',
    week: 'weeks',
    day: 'days',
    hour: 'hours',
    minute: 'minutes',
    second: 'seconds',
  };
  const out = map[u];
  if (!out) throw new FormulaError('bad_unit');
  return out;
}

function addTo(d: FDate, n: number, unit: Unit): FDate {
  const x = new Date(d.t);
  const k = Math.trunc(n);
  switch (unit) {
    case 'years':
      x.setFullYear(x.getFullYear() + k);
      break;
    case 'quarters':
      x.setMonth(x.getMonth() + 3 * k);
      break;
    case 'months':
      x.setMonth(x.getMonth() + k);
      break;
    case 'weeks':
      x.setDate(x.getDate() + 7 * k);
      break;
    case 'days':
      x.setDate(x.getDate() + k);
      break;
    case 'hours':
      return new FDate(d.t + k * 3_600_000, false);
    case 'minutes':
      return new FDate(d.t + k * 60_000, false);
    case 'seconds':
      return new FDate(d.t + k * 1000, false);
  }
  return new FDate(x.getTime(), d.dateOnly);
}

function between(a: FDate, b: FDate, unit: Unit): number {
  const ms = a.t - b.t;
  const da = new Date(a.t);
  const db = new Date(b.t);
  const months = (da.getFullYear() - db.getFullYear()) * 12 + (da.getMonth() - db.getMonth()) - (ms >= 0 ? (da.getDate() < db.getDate() ? 1 : 0) : da.getDate() > db.getDate() ? -1 : 0);
  switch (unit) {
    case 'years':
      return Math.trunc(months / 12);
    case 'quarters':
      return Math.trunc(months / 3);
    case 'months':
      return months;
    case 'weeks':
      return Math.trunc(ms / (7 * DAY));
    case 'days':
      // Entre días (sin hora): por días calendario, sin corrimiento por horario de verano.
      if (a.dateOnly || b.dateOnly) return Math.round((Date.UTC(da.getFullYear(), da.getMonth(), da.getDate()) - Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())) / DAY);
      return Math.trunc(ms / DAY);
    case 'hours':
      return Math.trunc(ms / 3_600_000);
    case 'minutes':
      return Math.trunc(ms / 60_000);
    case 'seconds':
      return Math.trunc(ms / 1000);
  }
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** formatDate(fecha, "YYYY-MM-DD"): tokens de moment/Notion más comunes. */
function formatDateWith(d: FDate, fmt: string): string {
  const x = new Date(d.t);
  const tokens: Record<string, () => string> = {
    YYYY: () => String(x.getFullYear()),
    YY: () => String(x.getFullYear()).slice(-2),
    MMMM: () => MONTHS_LONG[x.getMonth()],
    MMM: () => MONTHS_SHORT[x.getMonth()],
    MM: () => pad(x.getMonth() + 1),
    M: () => String(x.getMonth() + 1),
    DD: () => pad(x.getDate()),
    D: () => String(x.getDate()),
    dddd: () => DAYS_LONG[x.getDay()],
    ddd: () => DAYS_LONG[x.getDay()].slice(0, 3),
    HH: () => pad(x.getHours()),
    H: () => String(x.getHours()),
    hh: () => pad(((x.getHours() + 11) % 12) + 1),
    h: () => String(((x.getHours() + 11) % 12) + 1),
    mm: () => pad(x.getMinutes()),
    ss: () => pad(x.getSeconds()),
    A: () => (x.getHours() < 12 ? 'AM' : 'PM'),
    a: () => (x.getHours() < 12 ? 'am' : 'pm'),
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, (tok) => tokens[tok]?.() ?? tok);
}

// ---------- Funciones ----------

type Fn = (args: FValue[], ctx: EvalCtx) => FValue;

const flat = (args: FValue[]): FValue[] => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
const nums = (args: FValue[]): number[] => flat(args).filter((v) => v !== null && v !== '').map(toNum);
const arg = (args: FValue[], i: number): FValue => (i < args.length ? args[i] : null);
const list = (v: FValue): FValue[] => (Array.isArray(v) ? v : v === null || v === '' ? [] : [v]);

/** Las funciones con `length === 0` se pueden escribir sin paréntesis (`now`, `pi`). */
const FUNCTIONS: Record<string, Fn> = {
  // Lógica (if/ifs/and/or se evalúan perezosos en evalNode).
  if: () => null,
  ifs: () => null,
  and: (a) => a.every(toBool),
  or: (a) => a.some(toBool),
  not: (a) => !toBool(arg(a, 0)),
  empty: (a) => isEmpty(arg(a, 0)),
  equal: (a) => equals(arg(a, 0), arg(a, 1)),
  unequal: (a) => !equals(arg(a, 0), arg(a, 1)),
  // Texto
  concat: (a) => a.every(Array.isArray) && a.length > 0 ? a.flat() : a.map(toText).join(''),
  join: (a) => {
    if (Array.isArray(a[0])) return a[0].map(toText).join(toText(arg(a, 1)));
    return a.slice(1).map(toText).join(toText(arg(a, 0)));
  },
  length: (a) => (Array.isArray(a[0]) ? a[0].length : toText(arg(a, 0)).length),
  contains: (a) => {
    const v = arg(a, 0);
    if (Array.isArray(v)) return v.some((x) => equals(x, arg(a, 1)));
    return toText(v).toLowerCase().includes(toText(arg(a, 1)).toLowerCase());
  },
  includes: (a) => list(arg(a, 0)).some((x) => equals(x, arg(a, 1))),
  replace: (a) => toText(arg(a, 0)).replace(toText(arg(a, 1)), toText(arg(a, 2))),
  replaceall: (a) => toText(arg(a, 0)).split(toText(arg(a, 1))).join(toText(arg(a, 2))),
  lower: (a) => toText(arg(a, 0)).toLowerCase(),
  upper: (a) => toText(arg(a, 0)).toUpperCase(),
  trim: (a) => toText(arg(a, 0)).trim(),
  substring: (a) => toText(arg(a, 0)).substring(toNum(arg(a, 1)), a.length > 2 ? toNum(arg(a, 2)) : undefined),
  slice: (a) => {
    const v = arg(a, 0);
    const s = toNum(arg(a, 1));
    const e = a.length > 2 ? toNum(arg(a, 2)) : undefined;
    return Array.isArray(v) ? v.slice(s, e) : toText(v).slice(s, e);
  },
  startswith: (a) => toText(arg(a, 0)).startsWith(toText(arg(a, 1))),
  endswith: (a) => toText(arg(a, 0)).endsWith(toText(arg(a, 1))),
  split: (a) => toText(arg(a, 0)).split(toText(arg(a, 1))).slice(0, 1000),
  repeat: (a) => toText(arg(a, 0)).repeat(Math.max(0, Math.min(100, Math.trunc(toNum(arg(a, 1)))))),
  format: (a) => toText(arg(a, 0)),
  tonumber: (a) => {
    const v = arg(a, 0);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof FDate) return v.t;
    const n = Number(toText(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  },
  style: (a) => toText(arg(a, 0)),
  unstyle: (a) => toText(arg(a, 0)),
  link: (a) => toText(arg(a, 0)),
  // Números
  abs: (a) => Math.abs(toNum(arg(a, 0))),
  ceil: (a) => Math.ceil(toNum(arg(a, 0))),
  floor: (a) => Math.floor(toNum(arg(a, 0))),
  round: (a) => {
    const p = Math.max(0, Math.min(10, Math.trunc(toNum(arg(a, 1)))));
    const f = 10 ** p;
    return Math.round(toNum(arg(a, 0)) * f) / f;
  },
  sqrt: (a) => Math.sqrt(toNum(arg(a, 0))),
  cbrt: (a) => Math.cbrt(toNum(arg(a, 0))),
  pow: (a) => toNum(arg(a, 0)) ** toNum(arg(a, 1)),
  exp: (a) => Math.exp(toNum(arg(a, 0))),
  ln: (a) => Math.log(toNum(arg(a, 0))),
  log10: (a) => Math.log10(toNum(arg(a, 0))),
  log2: (a) => Math.log2(toNum(arg(a, 0))),
  sign: (a) => Math.sign(toNum(arg(a, 0))),
  mod: (a) => toNum(arg(a, 0)) % toNum(arg(a, 1)),
  min: (a) => {
    const n = nums(a);
    return n.length ? Math.min(...n) : null;
  },
  max: (a) => {
    const n = nums(a);
    return n.length ? Math.max(...n) : null;
  },
  sum: (a) => nums(a).reduce((s, x) => s + x, 0),
  mean: (a) => {
    const n = nums(a);
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null;
  },
  average: (a) => FUNCTIONS.mean(a, null as unknown as EvalCtx),
  median: (a) => {
    const n = nums(a).sort((x, y) => x - y);
    if (!n.length) return null;
    const m = Math.floor(n.length / 2);
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  },
  pi: () => Math.PI,
  e: () => Math.E,
  // Fechas
  now: (_a, ctx) => new FDate(ctx.now, false),
  today: (_a, ctx) => {
    const d = new Date(ctx.now);
    return new FDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), true);
  },
  dateadd: (a) => {
    const d = toDate(arg(a, 0));
    return d ? addTo(d, toNum(arg(a, 1)), unitOf(arg(a, 2))) : null;
  },
  datesubtract: (a) => {
    const d = toDate(arg(a, 0));
    return d ? addTo(d, -toNum(arg(a, 1)), unitOf(arg(a, 2))) : null;
  },
  datebetween: (a) => {
    const x = toDate(arg(a, 0));
    const y = toDate(arg(a, 1));
    return x && y ? between(x, y, unitOf(arg(a, 2))) : null;
  },
  formatdate: (a) => {
    const d = toDate(arg(a, 0));
    return d ? formatDateWith(d, a.length > 1 ? toText(arg(a, 1)) : 'MMM D, YYYY') : '';
  },
  parsedate: (a) => toDate(toText(arg(a, 0)).trim()),
  year: (a) => {
    const d = toDate(arg(a, 0));
    return d ? new Date(d.t).getFullYear() : null;
  },
  month: (a) => {
    const d = toDate(arg(a, 0));
    return d ? new Date(d.t).getMonth() + 1 : null;
  },
  date: (a) => {
    const d = toDate(arg(a, 0));
    return d ? new Date(d.t).getDate() : null;
  },
  /** Día de la semana como en Notion 2.0: 1 = lunes … 7 = domingo. */
  day: (a) => {
    const d = toDate(arg(a, 0));
    return d ? ((new Date(d.t).getDay() + 6) % 7) + 1 : null;
  },
  hour: (a) => {
    const d = toDate(arg(a, 0));
    return d ? new Date(d.t).getHours() : null;
  },
  minute: (a) => {
    const d = toDate(arg(a, 0));
    return d ? new Date(d.t).getMinutes() : null;
  },
  week: (a) => {
    const d = toDate(arg(a, 0));
    if (!d) return null;
    const x = new Date(d.t);
    const t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  },
  timestamp: (a) => toDate(arg(a, 0))?.t ?? null,
  fromtimestamp: (a) => new FDate(toNum(arg(a, 0)), false),
  datestart: (a) => toDate(arg(a, 0)),
  dateend: (a) => toDate(arg(a, 0)),
  // Listas
  at: (a) => {
    const l = list(arg(a, 0));
    const i = Math.trunc(toNum(arg(a, 1)));
    return l[i < 0 ? l.length + i : i] ?? null;
  },
  first: (a) => list(arg(a, 0))[0] ?? null,
  last: (a) => {
    const l = list(arg(a, 0));
    return l[l.length - 1] ?? null;
  },
  unique: (a) => {
    const seen = new Set<string>();
    return list(arg(a, 0)).filter((x) => {
      const k = toText(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  sort: (a) => [...list(arg(a, 0))].sort(compare),
  reverse: (a) => [...list(arg(a, 0))].reverse(),
  count: (a) => list(arg(a, 0)).filter((x) => !isEmpty(x)).length,
};

/** Funciones que se ofrecen en el editor de fórmulas (con su firma). */
export const FORMULA_FUNCTIONS: Array<{ name: string; sig: string; group: 'logic' | 'text' | 'number' | 'date' | 'list' }> = [
  { name: 'if', sig: 'if(condition, then, else)', group: 'logic' },
  { name: 'ifs', sig: 'ifs(cond1, value1, cond2, value2, else)', group: 'logic' },
  { name: 'and', sig: 'and(a, b)', group: 'logic' },
  { name: 'or', sig: 'or(a, b)', group: 'logic' },
  { name: 'not', sig: 'not(a)', group: 'logic' },
  { name: 'empty', sig: 'empty(value)', group: 'logic' },
  { name: 'concat', sig: 'concat(a, b, …)', group: 'text' },
  { name: 'join', sig: 'join(list, ", ")', group: 'text' },
  { name: 'length', sig: 'length(text)', group: 'text' },
  { name: 'contains', sig: 'contains(text, "x")', group: 'text' },
  { name: 'replace', sig: 'replace(text, "a", "b")', group: 'text' },
  { name: 'replaceAll', sig: 'replaceAll(text, "a", "b")', group: 'text' },
  { name: 'lower', sig: 'lower(text)', group: 'text' },
  { name: 'upper', sig: 'upper(text)', group: 'text' },
  { name: 'substring', sig: 'substring(text, start, end)', group: 'text' },
  { name: 'format', sig: 'format(value)', group: 'text' },
  { name: 'toNumber', sig: 'toNumber(text)', group: 'number' },
  { name: 'round', sig: 'round(number, decimals)', group: 'number' },
  { name: 'floor', sig: 'floor(number)', group: 'number' },
  { name: 'ceil', sig: 'ceil(number)', group: 'number' },
  { name: 'abs', sig: 'abs(number)', group: 'number' },
  { name: 'min', sig: 'min(a, b, …)', group: 'number' },
  { name: 'max', sig: 'max(a, b, …)', group: 'number' },
  { name: 'sum', sig: 'sum(a, b, …)', group: 'number' },
  { name: 'mean', sig: 'mean(a, b, …)', group: 'number' },
  { name: 'pow', sig: 'pow(base, exponent)', group: 'number' },
  { name: 'now', sig: 'now()', group: 'date' },
  { name: 'today', sig: 'today()', group: 'date' },
  { name: 'dateAdd', sig: 'dateAdd(date, 3, "days")', group: 'date' },
  { name: 'dateSubtract', sig: 'dateSubtract(date, 1, "weeks")', group: 'date' },
  { name: 'dateBetween', sig: 'dateBetween(end, start, "days")', group: 'date' },
  { name: 'formatDate', sig: 'formatDate(date, "YYYY-MM-DD")', group: 'date' },
  { name: 'year', sig: 'year(date)', group: 'date' },
  { name: 'month', sig: 'month(date)', group: 'date' },
  { name: 'day', sig: 'day(date)', group: 'date' },
  { name: 'first', sig: 'first(list)', group: 'list' },
  { name: 'last', sig: 'last(list)', group: 'list' },
  { name: 'at', sig: 'at(list, index)', group: 'list' },
  { name: 'unique', sig: 'unique(list)', group: 'list' },
  { name: 'sort', sig: 'sort(list)', group: 'list' },
];

// ---------- Evaluación ----------

export interface EvalCtx {
  /** Valor de una propiedad de la fila por nombre (lanza FormulaError si no existe). */
  getProp: (name: string) => FValue;
  now: number;
  /** Pasos restantes (corta fórmulas patológicas). */
  budget: { n: number };
}

function evalNode(n: FNode, ctx: EvalCtx): FValue {
  if (--ctx.budget.n < 0) throw new FormulaError('too_complex');
  switch (n.t) {
    case 'lit':
      return n.v;
    case 'prop':
      return ctx.getProp(n.name);
    case 'list':
      return n.items.map((x) => evalNode(x, ctx));
    case 'index': {
      const l = list(evalNode(n.a, ctx));
      const i = Math.trunc(toNum(evalNode(n.i, ctx)));
      return l[i < 0 ? l.length + i : i] ?? null;
    }
    case 'cond':
      return toBool(evalNode(n.c, ctx)) ? evalNode(n.a, ctx) : evalNode(n.b, ctx);
    case 'un': {
      const a = evalNode(n.a, ctx);
      return n.op === '-' ? -toNum(a) : !toBool(a);
    }
    case 'bin': {
      if (n.op === '&&') return toBool(evalNode(n.a, ctx)) && toBool(evalNode(n.b, ctx));
      if (n.op === '||') return toBool(evalNode(n.a, ctx)) || toBool(evalNode(n.b, ctx));
      const a = evalNode(n.a, ctx);
      const b = evalNode(n.b, ctx);
      switch (n.op) {
        case '+': {
          if (typeof a === 'string' || typeof b === 'string' || Array.isArray(a) || Array.isArray(b)) return toText(a) + toText(b);
          if (a instanceof FDate || b instanceof FDate) throw new FormulaError('date_math');
          return toNum(a) + toNum(b);
        }
        case '-':
          return toNum(a) - toNum(b);
        case '*':
          return toNum(a) * toNum(b);
        case '/': {
          const d = toNum(b);
          return d === 0 ? null : toNum(a) / d;
        }
        case '%': {
          const d = toNum(b);
          return d === 0 ? null : toNum(a) % d;
        }
        case '^':
          return toNum(a) ** toNum(b);
        case '==':
          return equals(a, b);
        case '!=':
          return !equals(a, b);
        case '>':
          return compare(a, b) > 0;
        case '<':
          return compare(a, b) < 0;
        case '>=':
          return compare(a, b) >= 0;
        case '<=':
          return compare(a, b) <= 0;
        default:
          throw new FormulaError('bad_operator');
      }
    }
    case 'call': {
      const name = n.name.toLowerCase();
      if (name === 'if') {
        if (n.args.length < 2) throw new FormulaError('if_args');
        return toBool(evalNode(n.args[0], ctx)) ? evalNode(n.args[1], ctx) : n.args[2] ? evalNode(n.args[2], ctx) : null;
      }
      if (name === 'ifs') {
        for (let i = 0; i + 1 < n.args.length; i += 2) if (toBool(evalNode(n.args[i], ctx))) return evalNode(n.args[i + 1], ctx);
        return n.args.length % 2 ? evalNode(n.args[n.args.length - 1], ctx) : null;
      }
      const fn = FUNCTIONS[name];
      if (!fn) throw new FormulaError(`unknown_function:${n.name}`);
      return fn(
        n.args.map((x) => evalNode(x, ctx)),
        ctx,
      );
    }
  }
}

export interface FormulaResult {
  value: FValue;
  error?: string;
}

/** Evalúa una fórmula; los errores vuelven en `error` (la celda muestra "Error"). */
export function evaluateFormula(
  src: string,
  propNames: Iterable<string>,
  getProp: (name: string) => FValue,
  now = Date.now(),
): FormulaResult {
  if (!src.trim()) return { value: null };
  try {
    const node = parseFormula(src, propNames);
    const value = evalNode(node, { getProp, now, budget: { n: 20_000 } });
    if (typeof value === 'number' && !Number.isFinite(value)) return { value: null };
    return { value };
  } catch (e) {
    return { value: null, error: e instanceof FormulaError ? e.message : 'error' };
  }
}

/** Tipo de un resultado (null si no dice nada: vacío). */
export function kindOf(v: FValue): FKind | null {
  if (v === null) return null;
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'checkbox';
  if (v instanceof FDate) return 'date';
  return 'text';
}
