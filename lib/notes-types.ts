/**
 * Notes — tipos y helpers puros (sin DB): los usan el servidor y el cliente.
 */
import type { DocsBlock } from './docs-types';
import { databaseTable } from './docs-database';

/** Tope de la subida directa del navegador a Blob en Notes. */
export const NOTES_MAX_BLOB_UPLOAD = 100 * 1024 * 1024;

export type NotesSort = 'updated' | 'created' | 'title';
export const NOTES_SORTS: readonly NotesSort[] = ['updated', 'created', 'title'];

/** Vista del panel izquierdo. */
export type NotesView = 'all' | 'pinned' | 'trash';

export interface NoteSummary {
  id: string;
  notebook_id: string | null;
  title: string;
  snippet: string;
  tags: string[];
  pinned: boolean;
  trashed: boolean;
  source_url: string | null;
  shared: boolean;
  created_at: string;
  updated_at: string;
  /** Lista "Compartidas conmigo": quién la compartió. */
  shared_by?: string | null;
  /** Acceso de quien la abre: propia, o compartida para ver o editar. */
  access?: 'owner' | 'edit' | 'view';
  /** Bloqueada con contraseña (el texto viaja cifrado; ver lib/notes-crypto.ts). */
  locked?: boolean;
}

export interface NoteLinkRef {
  id: string;
  title: string;
}

export interface NoteDetail extends NoteSummary {
  content: DocsBlock[];
  share_token: string | null;
  /** Notas que linkean a esta con [[ ]] (sin papelera). */
  backlinks?: NoteLinkRef[];
  /** Recordatorio con fecha y hora (sent_at: ya avisó). */
  reminder?: { at: string; sent_at: string | null } | null;
  /** Nota compartida por otra persona: su nombre (para el aviso del editor). */
  owner_name?: string | null;
  /** Nota bloqueada: el sobre cifrado (el contenido real está adentro). */
  lock?: NoteLockEnvelope | null;
}

/**
 * Sobre de una nota bloqueada. Se arma y se abre en el navegador
 * (lib/notes-crypto.ts): AES-GCM 256 con una clave derivada de la contraseña
 * con PBKDF2-SHA256. El servidor solo guarda esto; nunca la contraseña ni el
 * texto. `hint` es la pista opcional, en claro.
 */
export interface NoteLockEnvelope {
  /** 2: PBKDF2 + HKDF (clave y prueba separadas). 1: PBKDF2 de 64 bytes partido (se sigue abriendo). */
  v: 1 | 2;
  /** Iteraciones de PBKDF2. */
  iter: number;
  /** Sal (16 bytes) e IV (12 bytes), en base64. */
  salt: string;
  iv: string;
  /** JSON { title, content } cifrado, en base64. */
  ct: string;
  /** SHA-256 (base64) de la prueba de la contraseña: el servidor la compara antes de aceptar otro sobre. */
  vh: string;
  hint?: string;
}

/**
 * Datos de una nota para los disparadores de Flow (note.*): título y
 * etiquetas, nunca el contenido (las notas son de cada persona y un flow lo
 * ve todo el workspace).
 */
export function noteEventPayload(note: NoteSummary, personId: string) {
  return {
    note: {
      id: note.id,
      title: note.title,
      tags: note.tags,
      notebookId: note.notebook_id,
      sourceUrl: note.source_url,
      createdAt: note.created_at,
    },
    personId,
  };
}

/** Etiquetas nuevas de una nota (las que no tenía antes). */
export function addedTags(before: readonly string[], after: readonly string[]): string[] {
  const prev = new Set(before.map((t) => t.toLowerCase()));
  return after.filter((t) => !prev.has(t.toLowerCase()));
}

/** Href (sin locale) de una nota en la app: lo usan los links [[ ]] y los avisos. */
export function noteHref(id: string): string {
  return `/app/notes?note=${encodeURIComponent(id)}`;
}

/** Archivo de un bloque image/file de una nota, servido con chequeo de dueño (o del link público). */
export function noteFileHref(noteId: string, blockId: string, opts: { download?: boolean; share?: string | null } = {}): string {
  const sp = new URLSearchParams();
  if (opts.download) sp.set('download', '1');
  if (opts.share) sp.set('share', opts.share);
  const qs = sp.toString();
  return `/api/notes/${encodeURIComponent(noteId)}/files/${encodeURIComponent(blockId)}${qs ? `?${qs}` : ''}`;
}

export interface NotebookInfo {
  id: string;
  name: string;
  count: number;
  /** Pila (stack) a la que pertenece, o null. */
  stack?: string | null;
}

/** Plantilla propia de la persona (las de fábrica salen de lib/docs-templates.ts). */
export interface NoteTemplateInfo {
  id: string;
  name: string;
  title: string;
  content: DocsBlock[];
  updated_at: string;
}

/** Búsqueda guardada (como los Smart Folders de Apple Notes). */
export interface SavedSearchInfo {
  id: string;
  name: string;
  query: string;
}

export interface TagInfo {
  tag: string;
  count: number;
}

export const NOTE_TAG_MAX = 60;
export const NOTE_TAGS_PER_NOTE = 20;

/**
 * Normaliza un tag: minúsculas, sin '#', espacios colapsados a '-'. La barra
 * arma etiquetas anidadas como en Bear ("trabajo/clientes"): sin barras
 * repetidas ni en los extremos.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, NOTE_TAG_MAX)
    .replace(/\/+$/, '');
}

/** Nodo del árbol de etiquetas del sidebar. */
export interface TagNode {
  /** Etiqueta completa ("trabajo/clientes"). */
  tag: string;
  /** Último tramo ("clientes"). */
  label: string;
  depth: number;
  /** Notas con esta etiqueta o una de sus hijas. */
  count: number;
  hasChildren: boolean;
}

/**
 * Árbol de etiquetas en orden de recorrido (padre antes que hijas). Un padre
 * que nadie usa solo (p. ej. "trabajo" si solo existe "trabajo/clientes")
 * aparece igual, como en Bear. `count` de cada etiqueta ya cuenta las notas
 * de sus hijas (lo arma listTags); un padre que no vino suma sus hijas.
 */
export function buildTagTree(tags: ReadonlyArray<{ tag: string; count: number }>): TagNode[] {
  const counts = new Map(tags.map((t) => [t.tag, t.count]));
  const all = new Set<string>();
  for (const { tag } of tags) {
    const parts = tag.split('/');
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  // Orden por tramos: "a", "a/b", "a-c" (no "a-c" entre "a" y "a/b").
  const sorted = [...all].sort((a, b) => {
    const pa = a.split('/');
    const pb = b.split('/');
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const c = pa[i].localeCompare(pb[i]);
      if (c) return c;
    }
    return pa.length - pb.length;
  });
  const countOf = (tag: string): number => {
    const known = counts.get(tag);
    if (known !== undefined) return known;
    const depth = tag.split('/').length;
    let sum = 0;
    for (const o of sorted) if (o.startsWith(`${tag}/`) && o.split('/').length === depth + 1) sum += countOf(o);
    return sum;
  };
  return sorted.map((tag) => {
    const parts = tag.split('/');
    return {
      tag,
      label: parts[parts.length - 1],
      depth: parts.length - 1,
      count: countOf(tag),
      hasChildren: sorted.some((o) => o.startsWith(`${tag}/`)),
    };
  });
}

/** Renombra una etiqueta (y sus hijas) dentro de una lista de etiquetas. */
export function renameTagIn(tags: readonly string[], from: string, to: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const next = t === from ? to : t.startsWith(`${from}/`) ? `${to}${t.slice(from.length)}` : t;
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}

/** Saca una etiqueta (y sus hijas) de una lista. */
export function removeTagFrom(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag && !t.startsWith(`${tag}/`));
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** HTML-lite (subset de Docs) → texto plano, sin DOM (sirve en el servidor). */
export function htmlLiteToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

/** Bloques → texto plano (búsqueda, snippets y contexto para la AI). */
export function blocksToText(blocks: DocsBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'divider') continue;
    if (b.type === 'image' || b.type === 'file') {
      if (b.name) lines.push(b.name);
      continue;
    }
    if (b.type === 'table') {
      for (const row of b.rows ?? []) lines.push(row.join(' · '));
      continue;
    }
    if (b.type === 'database') {
      for (const row of databaseTable(b).rows) lines.push(row.filter(Boolean).join(' · '));
      continue;
    }
    const text = htmlLiteToText(b.content);
    if (b.type === 'todo') lines.push(`${b.checked ? '[x]' : '[ ]'} ${text}`);
    else if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') lines.push(`- ${text}`);
    else lines.push(text);
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Snippet de una línea para la lista de notas. */
export function makeSnippet(body: string, max = 140): string {
  const flat = flattenBody(body);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Texto de la nota en una línea; las tareas van como texto plano ("milk, eggs"). */
function flattenBody(body: string): string {
  return body
    .replace(/^\[[ x]\] (.*)$/gm, '$1,')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,$/, '');
}

/** Snippet centrado en el primer término encontrado (resultados de búsqueda). */
export function snippetAround(body: string, terms: string[], max = 140): string {
  // Las marcas de tarea se sacan antes de aplanar: después ya no hay líneas.
  const flat = flattenBody(body);
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || flat.length <= max) return makeSnippet(flat, max);
  const start = Math.max(0, at - 40);
  const slice = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice}${start + max < flat.length ? '…' : ''}`;
}

/** Términos de búsqueda (letras/números unicode, sin operadores FTS). */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 0).slice(0, 12);
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Bloques de una nota recortada: link a la fuente + la selección como cita. */
export function clipBlocks(url: string, selection: string): DocsBlock[] {
  const id = () => crypto.randomUUID();
  const blocks: DocsBlock[] = [
    { id: id(), type: 'paragraph', content: `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` },
  ];
  const paragraphs = selection
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50);
  for (const p of paragraphs) blocks.push({ id: id(), type: 'quote', content: esc(p) });
  blocks.push({ id: id(), type: 'paragraph', content: '' });
  return blocks;
}

/** Bookmarklet de captura: abre /app/notes/clip con url, título y selección. */
export function clipBookmarklet(origin: string, locale: string): string {
  const base = `${origin}/${locale}/app/notes/clip`;
  return (
    'javascript:(function(){var s=window.getSelection?String(window.getSelection()):"";' +
    `var w=window.open("${base}?url="+encodeURIComponent(location.href)+"&title="+encodeURIComponent(document.title)+"&selection="+encodeURIComponent(s.slice(0,4000)),"zsclip","width=560,height=680");` +
    // La ventana avisa que está lista y recibe la página como la ve la persona (también con sesión).
    `window.addEventListener("message",function(e){if(e.source===w&&e.data==="zs-clip-ready")w.postMessage({zsClipHtml:new TextDecoder().decode(new TextEncoder().encode(document.documentElement.outerHTML).slice(0,2000000))},"${origin}");});})();`
  );
}
