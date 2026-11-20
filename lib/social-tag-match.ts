/**
 * Social: lo puro de las sugerencias de #hashtags y @menciones (sin base ni
 * servidor), para el compositor y para lib/social-tags.ts.
 */
import { extractTags } from './social-networks';

export interface TagCount {
  tag: string;
  n: number;
}

export interface SocialTagSuggestions {
  hashtags: TagCount[];
  mentions: TagCount[];
}

/** Cuenta tags sin distinguir mayúsculas; se queda con la forma más usada. */
export function countTags(texts: string[], max = 200): SocialTagSuggestions {
  const tally = (pick: (t: ReturnType<typeof extractTags>) => string[]) => {
    const byKey = new Map<string, { n: number; forms: Map<string, number> }>();
    for (const text of texts) {
      for (const tag of pick(extractTags(text))) {
        const key = tag.toLowerCase();
        const e = byKey.get(key) ?? { n: 0, forms: new Map<string, number>() };
        e.n += 1;
        e.forms.set(tag, (e.forms.get(tag) ?? 0) + 1);
        byKey.set(key, e);
      }
    }
    return [...byKey.values()]
      .map((e) => ({ tag: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0][0], n: e.n }))
      .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
      .slice(0, max);
  };
  return { hashtags: tally((t) => t.hashtags), mentions: tally((t) => t.mentions) };
}

/**
 * El tag que se está escribiendo justo antes del cursor: `#caf` → { kind: '#', query: 'caf', start }.
 * `start` es la posición del # o la @. Null si el cursor no está en un tag.
 */
export function tagAtCaret(text: string, caret: number): { kind: '#' | '@'; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)([#@])([\p{L}\p{N}_.-]{0,100})$/u.exec(before);
  if (!m) return null;
  const kind = m[2] as '#' | '@';
  // Los hashtags no llevan punto ni guion (extractTags tampoco los cuenta).
  if (kind === '#' && /[.-]/.test(m[3])) return null;
  return { kind, query: m[3], start: before.length - m[3].length - 1 };
}

/** Hasta `limit` sugerencias que empiezan con lo escrito (sin la que ya está completa). */
export function matchTags(list: TagCount[], query: string, limit = 6): TagCount[] {
  const q = query.toLowerCase();
  return list.filter((x) => x.tag.toLowerCase().startsWith(q) && x.tag.toLowerCase() !== q).slice(0, limit);
}
