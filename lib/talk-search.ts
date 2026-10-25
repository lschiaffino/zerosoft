/**
 * Talk: búsqueda con modificadores, como la de Slack.
 *   in:#canal  in:@persona (DM)   -in:#canal
 *   from:@persona  from:me  -from:@persona
 *   has:link  has:file  has:pin  has:reaction  has::emoji:
 *   is:saved  is:thread
 *   before:2026-10-01  after:2026-09-01  on:2026-10-25  during:2026-10 (o un año)
 *   "frase exacta"  -palabra
 * Los nombres con espacios van entre comillas: from:"Ana María".
 * Puro: el servidor arma el SQL con el resultado (lib/talk.ts searchMessages).
 */

export type TalkHas = 'link' | 'file' | 'pin' | 'reaction';

export interface TalkSearchQuery {
  /** Palabras y frases que tienen que estar (todas). */
  terms: string[];
  /** Palabras que no tienen que estar. */
  excludes: string[];
  in: string[];
  notIn: string[];
  from: string[];
  notFrom: string[];
  has: TalkHas[];
  /** has::emoji: → reacción con ese emoji (nombre corto o carácter). */
  hasEmoji: string[];
  is: Array<'saved' | 'thread'>;
  /** Límites en ISO (UTC) inclusivo / exclusivo. */
  after: string | null;
  before: string | null;
}

const HAS: readonly TalkHas[] = ['link', 'file', 'pin', 'reaction'];

/** Separa la búsqueda en tokens respetando comillas: `from:"Ana María" hola "dos palabras"`. */
export function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?[a-z]+:)?"([^"]*)"|(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[2] !== undefined) out.push(m[1] ? `${m[1]}${m[2]}` : `"${m[2]}"`);
    else out.push(m[3]);
  }
  return out;
}

function dayStart(raw: string): Date | null {
  const v = raw.trim().toLowerCase();
  const now = new Date();
  if (v === 'today' || v === 'hoy' || v === 'hoje') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (v === 'yesterday' || v === 'ayer' || v === 'ontem') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** during:2026-10 → [1 de octubre, 1 de noviembre); during:2026 → el año. */
function period(raw: string): [Date, Date] | null {
  const ym = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (ym) {
    const y = Number(ym[1]);
    const mo = Number(ym[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    return [new Date(Date.UTC(y, mo, 1)), new Date(Date.UTC(y, mo + 1, 1))];
  }
  const y = /^(\d{4})$/.exec(raw);
  if (y) return [new Date(Date.UTC(Number(y[1]), 0, 1)), new Date(Date.UTC(Number(y[1]) + 1, 0, 1))];
  const d = dayStart(raw);
  return d ? [d, new Date(d.getTime() + 86_400_000)] : null;
}

const strip = (v: string, ch: '#' | '@') => (v.startsWith(ch) ? v.slice(1) : v).trim();

export function parseTalkSearch(q: string): TalkSearchQuery {
  const out: TalkSearchQuery = { terms: [], excludes: [], in: [], notIn: [], from: [], notFrom: [], has: [], hasEmoji: [], is: [], after: null, before: null };
  const later = (iso: string) => (!out.after || iso > out.after ? iso : out.after);
  const earlier = (iso: string) => (!out.before || iso < out.before ? iso : out.before);
  for (const tok of tokenize(q.slice(0, 500))) {
    const m = /^(-?)([a-z]+):(.+)$/i.exec(tok);
    if (m && !/^https?$/i.test(m[2])) {
      const neg = m[1] === '-';
      const key = m[2].toLowerCase();
      const val = m[3];
      if (key === 'in' || key === 'en' || key === 'em') {
        (neg ? out.notIn : out.in).push(val.startsWith('@') ? val : strip(val, '#'));
        continue;
      }
      if (key === 'from' || key === 'de') {
        (neg ? out.notFrom : out.from).push(strip(val, '@'));
        continue;
      }
      if ((key === 'has' || key === 'tiene' || key === 'tem') && !neg) {
        const v = val.toLowerCase();
        const alias: Record<string, TalkHas> = { link: 'link', links: 'link', enlace: 'link', file: 'file', files: 'file', archivo: 'file', arquivo: 'file', pin: 'pin', fijado: 'pin', reaction: 'reaction', reaccion: 'reaction', reacción: 'reaction', reação: 'reaction' };
        if (alias[v] && HAS.includes(alias[v]) && !out.has.includes(alias[v])) out.has.push(alias[v]);
        else if (/^:[a-z0-9_+-]+:$/i.test(val)) out.hasEmoji.push(val.slice(1, -1).toLowerCase());
        else if (/\p{Extended_Pictographic}/u.test(val)) out.hasEmoji.push(val);
        continue;
      }
      if ((key === 'is' || key === 'es' || key === 'e') && !neg) {
        const v = val.toLowerCase();
        if ((v === 'saved' || v === 'guardado' || v === 'salvo') && !out.is.includes('saved')) out.is.push('saved');
        else if ((v === 'thread' || v === 'hilo' || v === 'fio') && !out.is.includes('thread')) out.is.push('thread');
        continue;
      }
      if (key === 'before' || key === 'antes') {
        const d = dayStart(val);
        if (d) out.before = earlier(d.toISOString());
        continue;
      }
      if (key === 'after' || key === 'despues' || key === 'después' || key === 'depois') {
        const d = dayStart(val);
        // "after:X" es desde el día siguiente a X, como en Slack.
        if (d) out.after = later(new Date(d.getTime() + 86_400_000).toISOString());
        continue;
      }
      if (key === 'on' || key === 'el') {
        const d = dayStart(val);
        if (d) {
          out.after = later(d.toISOString());
          out.before = earlier(new Date(d.getTime() + 86_400_000).toISOString());
        }
        continue;
      }
      if (key === 'during' || key === 'durante') {
        const p = period(val);
        if (p) {
          out.after = later(p[0].toISOString());
          out.before = earlier(p[1].toISOString());
        }
        continue;
      }
    }
    if (tok.startsWith('"') && tok.endsWith('"')) {
      // Una frase vacía (o solo comillas) no busca nada.
      const phrase = tok.slice(1, -1).trim();
      if (phrase) out.terms.push(phrase);
      continue;
    }
    if (!tok.replace(/["']/g, '').trim()) continue;
    if (tok.startsWith('-') && tok.length > 1) {
      out.excludes.push(tok.slice(1));
      continue;
    }
    out.terms.push(tok);
  }
  return out;
}

/** ¿Hay algo para buscar? (texto o algún filtro). */
export function hasSearchCriteria(q: TalkSearchQuery): boolean {
  return (
    q.terms.length > 0 ||
    q.in.length > 0 ||
    q.from.length > 0 ||
    q.has.length > 0 ||
    q.hasEmoji.length > 0 ||
    q.is.length > 0 ||
    !!q.after ||
    !!q.before
  );
}
