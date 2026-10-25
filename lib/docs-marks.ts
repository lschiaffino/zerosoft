/**
 * Docs: marcas de colaboración dentro del HTML-lite de un bloque, sin DOM
 * (corre igual en el navegador, en el servidor y en los tests).
 *
 * - Comentario sobre texto: `<span data-comment="<id>">texto</span>`. El id
 *   es el `anchor_id` del hilo en docs_comments; el resaltado viaja con el
 *   texto cuando se edita alrededor.
 * - Sugerencia: `<span data-sug="<id>" data-sug-kind="ins|del" data-sug-by="<user>">`.
 *   Una inserción se ve subrayada y un borrado tachado hasta que alguien con
 *   edición la acepta o la rechaza. Un reemplazo es un del y un ins con el
 *   mismo id.
 *
 * Todo trabaja sobre offsets de texto plano (como lib/docs-richtext.ts): las
 * entidades cuentan como un carácter y los tags no cuentan.
 */

export const MARK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Token =
  | { t: 'text'; raw: string }
  | { t: 'open'; tag: string; raw: string; attrs: Record<string, string> }
  | { t: 'close'; tag: string; raw: string }
  | { t: 'void'; raw: string };

const TOKEN_RE = /<\/?[a-zA-Z][^>]*>|[^<]+|</g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
const VOID_TAGS = new Set(['br', 'img', 'hr', 'wbr']);
const ENTITY_RE = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g;

export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  for (const m of html.matchAll(TOKEN_RE)) {
    const raw = m[0];
    if (raw[0] !== '<' || raw === '<') {
      out.push({ t: 'text', raw });
      continue;
    }
    const close = raw[1] === '/';
    const tag = (raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/)?.[1] ?? '').toLowerCase();
    if (close) {
      out.push({ t: 'close', tag, raw });
      continue;
    }
    if (VOID_TAGS.has(tag) || raw.endsWith('/>')) {
      out.push({ t: 'void', raw });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of raw.matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = a[2];
    out.push({ t: 'open', tag, raw, attrs });
  }
  return out;
}

const join = (tokens: Token[]) => tokens.map((x) => x.raw).join('');

/** Partes de un texto crudo: cada entidad es un solo carácter plano. */
function textUnits(raw: string): string[] {
  const units: string[] = [];
  let last = 0;
  for (const m of raw.matchAll(ENTITY_RE)) {
    for (const ch of raw.slice(last, m.index)) units.push(ch);
    units.push(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  for (const ch of raw.slice(last)) units.push(ch);
  return units;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeUnit(u: string): string {
  if (u.length === 1 || u[0] !== '&') return u;
  const name = u.slice(1, -1);
  if (ENTITIES[name]) return ENTITIES[name];
  if (name[0] === '#') {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    if (Number.isFinite(code)) return String.fromCodePoint(code);
  }
  return u;
}

/** Texto plano del HTML-lite (sin DOM). */
export function flatText(html: string): string {
  if (!html) return '';
  let out = '';
  for (const tk of tokenize(html)) if (tk.t === 'text') out += textUnits(tk.raw).map(decodeUnit).join('');
  return out;
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Corta el HTML en un offset de texto plano. Los tags abiertos en el corte se
 * cierran a la izquierda y se vuelven a abrir a la derecha (como cloneContents).
 */
export function splitAtFlat(html: string, offset: number): [string, string] {
  const tokens = tokenize(html);
  const stack: Array<Extract<Token, { t: 'open' }>> = [];
  let remaining = Math.max(0, offset);
  const left: string[] = [];
  let i = 0;
  for (; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'text') {
      const units = textUnits(tk.raw);
      if (remaining < units.length) {
        left.push(units.slice(0, remaining).join(''));
        const rest = units.slice(remaining).join('');
        const right = [...stack.map((s) => s.raw), rest, ...tokens.slice(i + 1).map((x) => x.raw)];
        return [left.join('') + [...stack].reverse().map((s) => `</${s.tag}>`).join(''), right.join('')];
      }
      remaining -= units.length;
      left.push(tk.raw);
      continue;
    }
    if (remaining === 0 && tk.t === 'open') break;
    if (tk.t === 'open') stack.push(tk);
    else if (tk.t === 'close') {
      const idx = stack.map((s) => s.tag).lastIndexOf(tk.tag);
      if (idx >= 0) stack.splice(idx, 1);
    }
    left.push(tk.raw);
  }
  const rest = tokens.slice(i).map((x) => x.raw).join('');
  return [left.join('') + [...stack].reverse().map((s) => `</${s.tag}>`).join(''), stack.map((s) => s.raw).join('') + rest];
}

/** Quita tags vacíos (`<strong></strong>`, `<span ...></span>`) y une spans idénticos contiguos. */
export function tidy(html: string): string {
  let prev = '';
  let out = html;
  while (prev !== out) {
    prev = out;
    out = out.replace(/<(strong|em|u|s|code|span|a)(\s[^>]*)?><\/\1>/g, '');
    // `</span><span X>` con el mismo X que el span que se cierra: es un solo span.
    const tokens = tokenize(out);
    const stack: Token[] = [];
    const res: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      const next = tokens[i + 1];
      if (tk.t === 'open') stack.push(tk);
      if (tk.t === 'close') {
        const open = stack.pop();
        if (open && open.t === 'open' && next && next.t === 'open' && next.raw === open.raw && tk.tag === open.tag) {
          // Se saltea el cierre y la reapertura: el span sigue abierto.
          stack.push(open);
          i++;
          continue;
        }
      }
      res.push(tk);
    }
    out = join(res);
  }
  return out;
}

// ---------- Spans de colaboración ----------

export interface SugAttrs {
  id: string;
  kind: 'ins' | 'del';
  by: string;
}

function sugOf(tk: Token): SugAttrs | null {
  if (tk.t !== 'open' || tk.tag !== 'span') return null;
  const id = tk.attrs['data-sug'];
  const kind = tk.attrs['data-sug-kind'];
  if (!id || (kind !== 'ins' && kind !== 'del')) return null;
  return { id, kind, by: tk.attrs['data-sug-by'] ?? '' };
}

function commentOf(tk: Token): string | null {
  if (tk.t !== 'open' || tk.tag !== 'span') return null;
  return tk.attrs['data-comment'] ?? null;
}

export function sugOpen(s: SugAttrs): string {
  return `<span data-sug="${s.id}" data-sug-kind="${s.kind}" data-sug-by="${s.by}">`;
}

export function commentOpen(id: string): string {
  return `<span data-comment="${id}">`;
}

/**
 * Recorre los spans: `drop` saca el span con su contenido, `unwrap` saca solo
 * los tags del span. Los spans anidados adentro de uno que se saca se van con él.
 */
function rewriteSpans(html: string, decide: (tk: Extract<Token, { t: 'open' }>) => 'keep' | 'drop' | 'unwrap'): string {
  if (!html.includes('<span')) return html;
  const tokens = tokenize(html);
  const out: Token[] = [];
  const stack: Array<'keep' | 'drop' | 'unwrap' | 'other'> = [];
  let dropDepth = 0;
  for (const tk of tokens) {
    if (tk.t === 'open') {
      const d = tk.tag === 'span' ? decide(tk) : 'other';
      stack.push(dropDepth > 0 ? 'drop' : d);
      if (dropDepth > 0 || d === 'drop') {
        dropDepth++;
        continue;
      }
      if (d === 'unwrap') continue;
      out.push(tk);
      continue;
    }
    if (tk.t === 'close') {
      const d = stack.pop();
      if (dropDepth > 0) {
        dropDepth--;
        continue;
      }
      if (d === 'unwrap') continue;
      out.push(tk);
      continue;
    }
    if (dropDepth > 0) continue;
    out.push(tk);
  }
  return tidy(join(out));
}

/** Sin resaltados de comentarios (el texto queda). */
export function stripComments(html: string, id?: string): string {
  return rewriteSpans(html, (tk) => {
    const c = commentOf(tk);
    return c !== null && (id === undefined || c === id) ? 'unwrap' : 'keep';
  });
}

/** Acepta (true) o rechaza (false) una sugerencia por id, o todas sin id. */
export function resolveSuggestionHtml(html: string, accept: boolean, id?: string): string {
  return rewriteSpans(html, (tk) => {
    const s = sugOf(tk);
    if (!s || (id !== undefined && s.id !== id)) return 'keep';
    if (accept) return s.kind === 'ins' ? 'unwrap' : 'drop';
    return s.kind === 'ins' ? 'drop' : 'unwrap';
  });
}

export function hasSuggestions(html: string): boolean {
  return html.includes('data-sug=');
}

export interface DocsSuggestion {
  id: string;
  by: string;
  blockId: string;
  /** Texto insertado y borrado (un reemplazo trae los dos). */
  inserted: string;
  deleted: string;
  /** Bloque entero sugerido (Enter en modo sugerir). */
  block?: boolean;
}

interface SugBlock {
  id: string;
  content: string;
  suggestion?: { id: string; by: string } | null;
}

/** Sugerencias de una lista de bloques, en orden de aparición. */
export function listSuggestions(blocks: SugBlock[]): DocsSuggestion[] {
  const byId = new Map<string, DocsSuggestion>();
  for (const b of blocks) {
    if (b.suggestion?.id) {
      const prev = byId.get(b.suggestion.id);
      const text = flatText(b.content);
      if (prev) prev.inserted += `\n${text}`;
      else byId.set(b.suggestion.id, { id: b.suggestion.id, by: b.suggestion.by, blockId: b.id, inserted: text, deleted: '', block: true });
      continue;
    }
    if (!b.content || !hasSuggestions(b.content)) continue;
    const stack: Array<SugAttrs | null> = [];
    for (const tk of tokenize(b.content)) {
      if (tk.t === 'open') stack.push(tk.tag === 'span' ? sugOf(tk) : null);
      else if (tk.t === 'close') stack.pop();
      else if (tk.t === 'text') {
        const s = [...stack].reverse().find((x) => x) ?? null;
        if (!s) continue;
        let cur = byId.get(s.id);
        if (!cur) {
          cur = { id: s.id, by: s.by, blockId: b.id, inserted: '', deleted: '' };
          byId.set(s.id, cur);
        }
        const text = textUnits(tk.raw).map(decodeUnit).join('');
        if (s.kind === 'ins') cur.inserted += text;
        else cur.deleted += text;
      }
    }
  }
  return [...byId.values()];
}

/** Anclas de comentarios que hay en el texto de los bloques. */
export function listCommentAnchors(blocks: Array<{ content: string }>): string[] {
  const out = new Set<string>();
  for (const b of blocks) {
    if (!b.content?.includes('data-comment')) continue;
    for (const tk of tokenize(b.content)) {
      const c = commentOf(tk);
      if (c) out.add(c);
    }
  }
  return [...out];
}

/** Envuelve [start, end) de texto plano en el resaltado de un comentario. */
export function wrapComment(html: string, start: number, end: number, id: string): string {
  if (end <= start || !MARK_ID_RE.test(id)) return html;
  const [before, rest] = splitAtFlat(html, start);
  const [mid, after] = splitAtFlat(rest, end - start);
  if (!flatText(mid)) return html;
  return tidy(`${before}${commentOpen(id)}${mid}</span>${after}`);
}

/** Spans de sugerencia abiertos en un offset de texto plano (de afuera hacia adentro). */
function sugStackAt(html: string, offset: number): SugAttrs[] {
  const stack: Array<SugAttrs | null> = [];
  let remaining = offset;
  for (const tk of tokenize(html)) {
    if (tk.t === 'text') {
      const len = textUnits(tk.raw).length;
      // El offset cae adentro o justo al final de este texto: cuenta el span que lo contiene.
      if (remaining <= len && remaining > 0) return stack.filter((x): x is SugAttrs => !!x);
      remaining -= len;
      continue;
    }
    if (tk.t === 'open') stack.push(tk.tag === 'span' ? sugOf(tk) : null);
    else if (tk.t === 'close') stack.pop();
  }
  return [];
}

/**
 * Borrado sugerido de un tramo: lo que es inserción propia todavía sin
 * aceptar se borra de verdad; lo que ya estaba tachado queda igual; el resto
 * se envuelve en un span de borrado.
 */
function markDeleted(fragment: string, userId: string, delId: string): string {
  const tokens = tokenize(fragment);
  const stack: Array<SugAttrs | null> = [];
  const out: string[] = [];
  for (const tk of tokens) {
    if (tk.t === 'open') {
      stack.push(tk.tag === 'span' ? sugOf(tk) : null);
      out.push(tk.raw);
      continue;
    }
    if (tk.t === 'close') {
      stack.pop();
      out.push(tk.raw);
      continue;
    }
    if (tk.t !== 'text') {
      out.push(tk.raw);
      continue;
    }
    const s = [...stack].reverse().find((x) => x) ?? null;
    if (s?.kind === 'ins' && s.by === userId) continue;
    if (s?.kind === 'del') {
      out.push(tk.raw);
      continue;
    }
    out.push(`${sugOpen({ id: delId, kind: 'del', by: userId })}${tk.raw}</span>`);
  }
  return out.join('');
}

export interface SuggestEditResult {
  html: string;
  /** Dónde queda el caret (texto plano). */
  caret: number;
  changed: boolean;
}

/**
 * Modo sugerir: el navegador ya aplicó el cambio (tipeo, borrar, pegar) y
 * `nextHtml` es el DOM serializado; se rehace sobre `prevHtml` como sugerencia.
 * `forward`: el borrado fue con Supr (el caret queda después de lo tachado).
 */
export function applySuggestEdit(
  prevHtml: string,
  nextHtml: string,
  userId: string,
  newId: () => string,
  opts: { forward?: boolean } = {},
): SuggestEditResult {
  const a = flatText(prevHtml);
  const b = flatText(nextHtml);
  if (a === b) return { html: prevHtml, caret: 0, changed: false };
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const deletedLen = a.length - s - p;
  const inserted = b.slice(p, b.length - s);

  const [before, rest] = splitAtFlat(prevHtml, p);
  const [mid, after] = splitAtFlat(rest, deletedLen);
  // Seguir escribiendo dentro (o al final) de una inserción propia: misma sugerencia.
  const around = sugStackAt(prevHtml, p);
  const own = [...around].reverse().find((x) => x.kind === 'ins' && x.by === userId);
  const id = own?.id ?? newId();
  const midOut = deletedLen > 0 ? markDeleted(mid, userId, id) : '';
  const ins = inserted ? `${sugOpen({ id, kind: 'ins', by: userId })}${escapeText(inserted)}</span>` : '';
  const html = tidy(`${before}${midOut}${ins}${after}`);
  const keptMid = flatText(midOut).length;
  const caret = inserted ? p + keptMid + inserted.length : opts.forward ? p + keptMid : p;
  return { html, caret, changed: html !== prevHtml };
}

// ---------- Validación en el servidor ----------

interface CheckBlock {
  id: string;
  content: string;
  suggestion?: { id: string; by: string } | null;
}

/** El documento "real": sin resaltados y con las sugerencias rechazadas. */
function baseline(blocks: CheckBlock[], withSuggestions: boolean): string {
  return JSON.stringify(
    blocks
      .filter((b) => !(withSuggestions && b.suggestion))
      .map((b) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { suggestion: _s, ...rest } = b;
        let content = stripComments(b.content ?? '');
        if (withSuggestions) content = resolveSuggestionHtml(content, false);
        return { ...rest, content };
      }),
  );
}

function suggestionKeys(blocks: CheckBlock[], filter: (s: DocsSuggestion) => boolean): string[] {
  return listSuggestions(blocks)
    .filter(filter)
    .map((s) => `${s.id}|${s.by}|${s.inserted}|${s.deleted}|${s.block ? 1 : 0}`)
    .sort();
}

/**
 * Quien solo puede comentar (o cualquiera en una página bloqueada) guarda el
 * contenido entero, pero solo puede haber cambiado resaltados de comentarios
 * y, si `allowSuggestions`, sus propias sugerencias. Devuelve el motivo del
 * rechazo o null si el cambio es válido.
 */
export function checkMarksOnlyChange(
  prev: CheckBlock[],
  next: CheckBlock[],
  userId: string,
  allowSuggestions: boolean,
): 'content_changed' | 'foreign_suggestion' | null {
  if (baseline(prev, allowSuggestions) !== baseline(next, allowSuggestions)) return 'content_changed';
  if (!allowSuggestions) {
    // Bloqueada: ni siquiera sugerencias nuevas o borradas.
    const all = () => true;
    if (suggestionKeys(prev, all).join('\n') !== suggestionKeys(next, all).join('\n')) return 'content_changed';
    return null;
  }
  // Las sugerencias ajenas quedan intactas y no se pueden firmar como otra persona.
  const foreign = (s: DocsSuggestion) => s.by !== userId;
  if (suggestionKeys(prev, foreign).join('\n') !== suggestionKeys(next, foreign).join('\n')) return 'foreign_suggestion';
  return null;
}

/**
 * Lo que ve quien solo lee (centro de ayuda, lectura, export, búsqueda): el
 * texto vigente, sin sugerencias pendientes ni resaltados de comentarios.
 */
export function cleanForReaders<T extends { content: string; suggestion?: { id: string; by: string } | null }>(blocks: T[]): T[] {
  return blocks
    .filter((b) => !b.suggestion)
    .map((b) =>
      b.content && (b.content.includes('data-sug=') || b.content.includes('data-comment='))
        ? { ...b, content: stripComments(resolveSuggestionHtml(b.content, false)) }
        : b,
    );
}

/** Ids de sugerencias que aparecen en `next` y no estaban en `prev`. */
export function newSuggestionIds(prev: CheckBlock[], next: CheckBlock[]): string[] {
  const before = new Set(listSuggestions(prev).map((s) => s.id));
  return listSuggestions(next)
    .map((s) => s.id)
    .filter((id) => !before.has(id));
}
