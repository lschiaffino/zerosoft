/**
 * CRM — @menciones en notas y tareas (puro: lo usan server y client).
 *
 * Una mención es texto plano: "@" seguido del nombre de una persona del
 * workspace (o de su email), como lo inserta el autocompletado del timeline.
 * Así el texto se lee igual en cualquier lado (exportes, API, emails) y
 * también funciona si alguien la escribe a mano. Se reconoce el nombre más
 * largo que coincide (Ana María antes que Ana) y sin importar mayúsculas.
 */

export interface Mentionable {
  id: string;
  name: string | null;
  email: string;
}

/** Textos que mencionan a la persona: su nombre y su email. */
function handlesOf(m: Mentionable): string[] {
  const out = [m.email.trim()];
  const name = m.name?.trim();
  if (name) out.push(name);
  return out.filter(Boolean);
}

/** Lo que sigue a la mención no puede continuar la palabra (letra, número, _ o @). */
function boundaryAfter(text: string, end: number): boolean {
  const next = text.charAt(end);
  return !next || !/[\p{L}\p{N}_@]/u.test(next);
}

/** Lo que precede al @ no puede ser parte de una palabra (así un email no menciona). */
function boundaryBefore(text: string, at: number): boolean {
  if (at === 0) return true;
  return !/[\p{L}\p{N}_.]/u.test(text.charAt(at - 1));
}

export interface MentionHit {
  start: number;
  end: number;
  id: string;
}

/** Menciones del texto, en orden y sin superponerse. */
export function findMentionHits(text: string, people: Mentionable[]): MentionHit[] {
  if (!text.includes('@') || people.length === 0) return [];
  const handles = people
    .flatMap((p) => handlesOf(p).map((h) => ({ id: p.id, handle: h.toLowerCase() })))
    .sort((a, b) => b.handle.length - a.handle.length);
  const lower = text.toLowerCase();
  const hits: MentionHit[] = [];
  for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
    if (!boundaryBefore(text, i)) continue;
    for (const h of handles) {
      const end = i + 1 + h.handle.length;
      if (lower.startsWith(h.handle, i + 1) && boundaryAfter(text, end)) {
        hits.push({ start: i, end, id: h.id });
        i = end - 1;
        break;
      }
    }
  }
  return hits;
}

/** Ids de las personas mencionadas (sin repetir). */
export function findMentions(text: string, people: Mentionable[]): string[] {
  return [...new Set(findMentionHits(text, people).map((h) => h.id))];
}

/** Menciones que aparecen en `after` y no estaban en `before` (para avisar solo lo nuevo al editar). */
export function newMentions(before: string, after: string, people: Mentionable[]): string[] {
  const old = new Set(findMentions(before, people));
  return findMentions(after, people).filter((id) => !old.has(id));
}

export type MentionSegment = { text: string; mention?: false } | { text: string; mention: true; id: string };

/** El texto partido en tramos normales y menciones (para resaltarlas). */
export function mentionSegments(text: string, people: Mentionable[]): MentionSegment[] {
  const hits = findMentionHits(text, people);
  if (!hits.length) return [{ text }];
  const out: MentionSegment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push({ text: text.slice(pos, h.start) });
    out.push({ text: text.slice(h.start, h.end), mention: true, id: h.id });
    pos = h.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/**
 * Autocompletado: si el cursor está justo después de "@algo" (sin espacios
 * de por medio, o con hasta dos palabras para nombres), devuelve la consulta
 * y dónde empieza el @. null si no hay una mención en curso.
 */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1 || !boundaryBefore(text, at)) return null;
  const query = upto.slice(at + 1);
  if (query.length > 40 || /\n/.test(query) || (query.match(/\s/g)?.length ?? 0) > 2) return null;
  return { query, start: at };
}

/** Personas que coinciden con la consulta del autocompletado (nombre o email que empieza o contiene). */
export function mentionSuggestions(query: string, people: Mentionable[], limit = 6): Mentionable[] {
  const q = query.trim().toLowerCase();
  const score = (p: Mentionable): number => {
    const name = (p.name ?? '').toLowerCase();
    const email = p.email.toLowerCase();
    if (!q) return 1;
    if (name.startsWith(q) || email.startsWith(q)) return 3;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    return name.includes(q) || email.includes(q) ? 1 : 0;
  };
  return people
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.p.name ?? a.p.email).localeCompare(b.p.name ?? b.p.email))
    .slice(0, limit)
    .map((x) => x.p);
}

/** Texto que inserta el autocompletado para una persona. */
export function mentionText(p: Mentionable): string {
  return `@${p.name?.trim() || p.email}`;
}
