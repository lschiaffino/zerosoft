/**
 * Notes — operadores de búsqueda estilo Evernote. Puro (sin DB): lo usan
 * lib/notes.ts (arma el WHERE) y los tests.
 *
 *   tag:viaje  -tag:viejo  tag:pro*      tags (con prefijo y negación)
 *   notebook:"Trabajo"                   libreta por nombre
 *   intitle:factura                      palabra en el título
 *   created:20240131  created:day-7      creada desde esa fecha (también
 *   updated:week-2                       today, day, week, month, year ± N)
 *   todo:true | todo:false | todo:*      con tareas hechas / pendientes / cualquiera
 *
 * Lo que no es un operador conocido queda como texto libre. Las comillas
 * agrupan: notebook:"Mis recetas", "frase exacta" (se busca palabra por palabra).
 */
import { normalizeTag, searchTerms } from './notes-types';

export type NoteTodoFilter = 'checked' | 'unchecked' | 'any';

export interface NoteQuery {
  /** Términos de texto libre (título o cuerpo). */
  terms: string[];
  tags: string[];
  notTags: string[];
  notebooks: string[];
  notNotebooks: string[];
  intitle: string[];
  /** Límite inferior ISO (inclusive). */
  createdFrom: string | null;
  updatedFrom: string | null;
  todo: NoteTodoFilter | null;
}

const MAX_OPERATORS = 12;

/** Divide respetando comillas: `notebook:"Mis recetas" foo` → ['notebook:Mis recetas', 'foo']. */
export function tokenizeQuery(q: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of q.slice(0, 500)) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Fecha de un operador created:/updated: → ISO (inicio del día, UTC) o null
 * si no se entiende. Relativas como Evernote: day-1 = desde ayer, week = desde
 * el lunes de esta semana, month-2 = desde el 1 de hace dos meses.
 */
export function parseQueryDate(raw: string, now = new Date()): string | null {
  const v = raw.trim().toLowerCase();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(v);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return date.toISOString();
  }
  if (v === 'today') return startOfUtcDay(now).toISOString();
  m = /^(day|week|month|year)(?:-(\d{1,4}))?$/.exec(v);
  if (!m) return null;
  const n = m[2] ? Number(m[2]) : 0;
  const today = startOfUtcDay(now);
  switch (m[1]) {
    case 'day':
      return new Date(today.getTime() - n * 86_400_000).toISOString();
    case 'week': {
      // Semana desde el lunes.
      const dow = (today.getUTCDay() + 6) % 7;
      return new Date(today.getTime() - (dow + 7 * n) * 86_400_000).toISOString();
    }
    case 'month':
      return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1)).toISOString();
    default:
      return new Date(Date.UTC(today.getUTCFullYear() - n, 0, 1)).toISOString();
  }
}

/** Tag de un operador: normalizado, conservando un `*` final (prefijo). */
function queryTag(raw: string): string {
  const prefix = raw.endsWith('*');
  const tag = normalizeTag(prefix ? raw.slice(0, -1) : raw);
  return tag ? `${tag}${prefix ? '*' : ''}` : '';
}

export function parseNoteQuery(q: string, now = new Date()): NoteQuery {
  const out: NoteQuery = {
    terms: [],
    tags: [],
    notTags: [],
    notebooks: [],
    notNotebooks: [],
    intitle: [],
    createdFrom: null,
    updatedFrom: null,
    todo: null,
  };
  const free: string[] = [];
  let ops = 0;
  for (const token of tokenizeQuery(q)) {
    const m = /^(-?)([a-z]+):(.*)$/i.exec(token);
    const key = m?.[2].toLowerCase();
    const value = m?.[3].trim() ?? '';
    const known = key && ['tag', 'notebook', 'intitle', 'created', 'updated', 'todo'].includes(key);
    if (!m || !known || !value || ops >= MAX_OPERATORS) {
      free.push(token);
      continue;
    }
    ops++;
    const negated = m[1] === '-';
    switch (key) {
      case 'tag': {
        const tag = queryTag(value);
        if (tag) (negated ? out.notTags : out.tags).push(tag);
        break;
      }
      case 'notebook':
        (negated ? out.notNotebooks : out.notebooks).push(value.slice(0, 80));
        break;
      case 'intitle':
        out.intitle.push(...searchTerms(value));
        break;
      case 'created':
      case 'updated': {
        const iso = parseQueryDate(value, now);
        if (!iso) free.push(token);
        else if (key === 'created') out.createdFrom = iso;
        else out.updatedFrom = iso;
        break;
      }
      case 'todo': {
        const v = value.toLowerCase();
        out.todo = v === 'true' ? 'checked' : v === 'false' ? 'unchecked' : v === '*' ? 'any' : out.todo;
        if (!['true', 'false', '*'].includes(v)) free.push(token);
        break;
      }
    }
  }
  out.terms = searchTerms(free.join(' '));
  return out;
}

/** ¿La búsqueda tiene algo para filtrar? (una query de solo símbolos no). */
export function isEmptyNoteQuery(q: NoteQuery): boolean {
  return (
    q.terms.length === 0 &&
    q.tags.length === 0 &&
    q.notTags.length === 0 &&
    q.notebooks.length === 0 &&
    q.notNotebooks.length === 0 &&
    q.intitle.length === 0 &&
    !q.createdFrom &&
    !q.updatedFrom &&
    !q.todo
  );
}
