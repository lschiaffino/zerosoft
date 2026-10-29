/**
 * Docs, edición simultánea: lo que comparten el servidor y el navegador
 * (puro, sin DOM ni base). Ver lib/docs-coedit.ts.
 *
 * El texto de los bloques de texto que ya existen en el servidor viaja como
 * operaciones (tecla por tecla, transformadas contra las de las demás
 * personas); el resto (bloques nuevos, borrados, movidos, tipo, tildes,
 * bases) sigue por el guardado de la página con su fusión de tres vías. Para
 * que los dos caminos no se pisen, la fusión de la página deja quieto el
 * texto de esos bloques (`neutralize*`).
 */
import type { DocsBlock } from './docs-types';
import type { TextOp } from './docs-ot';

/** Bloques cuyo `content` es texto enriquecido que se edita con operaciones. */
export const COEDIT_TYPES = new Set([
  'paragraph',
  'heading',
  'bulleted_list_item',
  'numbered_list_item',
  'todo',
  'quote',
  'code',
  'toggle',
  'callout',
]);

/**
 * Un bloque con links a otras páginas (`data-page`) no viaja por operaciones:
 * el texto de esos links es el título de la página, que cada persona ve
 * distinto (o como "Página privada" si no puede abrirla). Ese bloque sigue
 * por el guardado, que enmascara por persona (lib/docs-guard.ts editorBlocks).
 */
/** Largo máximo del texto de un bloque (igual que DOCS_BLOCK_MAX del guardado, lib/docs-schema.ts). */
export const COEDIT_BLOCK_MAX = 20000;

export function hasPageLink(text: string): boolean {
  return text.includes('data-page');
}

export function isCoeditBlock(b: Pick<DocsBlock, 'type' | 'content'> | undefined | null): boolean {
  return !!b && COEDIT_TYPES.has(b.type) && typeof b.content === 'string' && !hasPageLink(b.content);
}

/**
 * Lo que el HTML-lite de un bloque nunca trae (lo saca el sanitizador del
 * servidor). Si una operación llega con algo de esto, el navegador lo sanea
 * antes de pintarlo (defensa en profundidad: el servidor ya no lo guarda).
 */
const UNSAFE_MARKUP_RE = /<\s*\/?\s*(script|style|iframe|frame|object|embed|img|svg|math|link|meta|base|form|input|button|textarea|select|video|audio|source|template|noscript)\b|<[^>]*\son[a-z]+\s*=|<[^>]*(javascript|vbscript)\s*:|<[^>]*data\s*:\s*text\/html|<[^>]*srcdoc\s*=/i;
export function hasUnsafeMarkup(html: string): boolean {
  return UNSAFE_MARKUP_RE.test(html);
}

/** Evento del feed en vivo de una página, tal como llega al navegador. */
export type CoeditEvent =
  | { id?: number; kind: 'op'; block: string; rev: number; session: string | null; seq: string | null; user: string | null; op: TextOp; hb: string; ha: string }
  | {
      id?: number;
      kind: 'cursor';
      session: string;
      user: string;
      name: string;
      image: string | null;
      block: string | null;
      start: number | null;
      end: number | null;
      mode: string;
    }
  | { id?: number; kind: 'leave'; session: string; user: string | null }
  | { id?: number; kind: 'save'; at: string; by: string | null }
  | { id?: number; kind: 'access'; access: string }
  | { id?: number; kind: 'revoked' };

/** Lo que el navegador manda por cada bloque cambiado. */
export interface CoeditOpItem {
  block: string;
  /** Versión del bloque sobre la que se escribió (null = se busca por la huella). */
  rev: number | null;
  /** Huella del texto base (lib/docs-ot.ts textHash). */
  hash: string;
  op: TextOp;
  /** Id de la operación en esta sesión: reintentar no la aplica dos veces. */
  seq: string;
  /** Texto base completo (solo al reconectar o después de un desfase): el servidor fusiona contra él. */
  base?: string;
}

export type CoeditOpStatus = 'ok' | 'dup' | 'resync' | 'gone' | 'unsupported' | 'too_large';

export interface CoeditOpResult {
  block: string;
  seq: string;
  status: CoeditOpStatus;
  /** Eventos del bloque en orden (reconciliación, la propia y la corrección del sanitizador). */
  events?: Array<Extract<CoeditEvent, { kind: 'op' }>>;
  /** Con `resync`: el texto y la versión actuales del bloque. */
  rev?: number;
  text?: string;
}

const withText = (b: DocsBlock, text: string): DocsBlock => (b.content === text ? b : { ...b, content: text });

/**
 * Guardado de la página con las operaciones activas: el texto de los bloques
 * que ya existen en el servidor (`theirs`) queda como está ahí; lo que manda
 * el editor solo cuenta para bloques nuevos. La base se iguala para que la
 * fusión no vea esos textos como cambios (si no, un bloque que alguien borró
 * volvía porque "lo editó" otra persona).
 */
export function neutralizeTextForSave(base: DocsBlock[] | null, theirs: DocsBlock[], ours: DocsBlock[]): { base: DocsBlock[] | null; ours: DocsBlock[] } {
  const t = new Map(theirs.map((b) => [b.id, b]));
  const o = new Map(ours.map((b) => [b.id, b]));
  const nextOurs = ours.map((b) => {
    const tb = t.get(b.id);
    return tb && isCoeditBlock(tb) && isCoeditBlock(b) ? withText(b, tb.content) : b;
  });
  const nextBase = base
    ? base.map((b) => {
        if (!isCoeditBlock(b)) return b;
        const tb = t.get(b.id);
        if (tb) return isCoeditBlock(tb) ? withText(b, tb.content) : b;
        const ob = o.get(b.id);
        return ob && isCoeditBlock(ob) ? withText(b, ob.content) : b;
      })
    : null;
  return { base: nextBase, ours: nextOurs };
}

/**
 * Del lado del editor: un cambio del servidor (`sent` → `merged`) sin el
 * texto de los bloques que manejan las operaciones (`managed`): ese texto ya
 * llega, transformado, por el feed en vivo.
 */
export function neutralizeTextForMerge(sent: DocsBlock[], merged: DocsBlock[], managed: (id: string) => boolean): DocsBlock[] {
  const s = new Map(sent.map((b) => [b.id, b]));
  return merged.map((b) => {
    const sb = s.get(b.id);
    return sb && managed(b.id) && isCoeditBlock(b) && isCoeditBlock(sb) ? withText(b, sb.content) : b;
  });
}
