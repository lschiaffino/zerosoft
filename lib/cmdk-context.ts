/**
 * Acciones en contexto para la paleta ⌘K (como el command menu de Linear).
 *
 * Una página registra un proveedor que devuelve las acciones sobre lo que la
 * persona está mirando (el issue abierto, la fila bajo el mouse, la
 * selección). La paleta lo consulta al abrirse y en cada render, así las
 * acciones nunca quedan con datos viejos. Una acción puede abrir una página
 * de opciones (Cambiar estado → Todo, In progress…), que también se puede
 * abrir directo con un atajo (S, P, A…) vía `openCommandMenu(id)`.
 */

/** Ícono a la izquierda de una opción (se dibuja en la paleta, como en Linear). */
export type CommandIcon =
  | { kind: 'status'; color: string | null; category: string | null }
  | { kind: 'priority'; value: string }
  | { kind: 'avatar'; name: string | null; empty?: boolean }
  | { kind: 'swatch'; color: string }
  | { kind: 'glyph'; name: 'plus' | 'tag' | 'project' | 'cycle' | 'estimate' | 'calendar' | 'parent' | 'team' | 'link' | 'copy' | 'archive' | 'trash' | 'open' | 'bell' | 'duplicate' | 'subissue' | 'user' };

/** Crear en línea desde una página (tipear un label nuevo + Enter lo crea). */
export interface CommandCreate {
  /** Texto de la opción: "Crear label “bug”". */
  label: (query: string) => string;
  run: (query: string) => void | Promise<void>;
}

export interface CommandAction {
  id: string;
  label: string;
  /** Atajo o valor actual, a la derecha. */
  meta?: string;
  /** Texto extra para la búsqueda (sinónimos, en inglés). */
  keywords?: string;
  /** Marca de seleccionado (labels, estado actual). */
  checked?: boolean;
  /** Color del punto a la izquierda (estado, label). */
  swatch?: string;
  run?: () => void;
  /** Página de opciones que abre esta acción. */
  children?: () => CommandAction[];
  /** Opciones según lo que se tipea (una fecha, una estimación). */
  dynamic?: (query: string) => CommandAction[];
  /** Opciones que vienen del servidor según lo que se tipea (elegir un issue padre). */
  load?: (query: string) => Promise<CommandAction[]>;
  /** Placeholder del input dentro de la página. */
  placeholder?: string;
  /** Después de correr, la paleta queda abierta (p. ej. tildar varios labels). */
  keepOpen?: boolean;
  icon?: CommandIcon;
  /** Tecla que elige esta opción con el input vacío (0–4 en prioridad, 1–9 en estado). */
  digit?: string;
  /** Opción "Sin X": al tipear va después de las coincidencias (y no aparece si no coincide). */
  isNone?: boolean;
  /** Solo aparece al tipear (atajos planos como "Cambiar estado a Done"). */
  searchOnly?: boolean;
  /** En una página: opción para crear lo tipeado si no existe. */
  create?: CommandCreate;
}

export interface CommandContext {
  /** Encabezado del grupo: "ZER-12" o "3 issues". */
  title: string;
  actions: CommandAction[];
}

type Provider = () => CommandContext | null;

// Pila: un panel encima de la página (la vista rápida de un issue) registra
// su proveedor y, al cerrarse, vuelve a mandar el de la página.
let providers: Provider[] = [];

/** Registra el proveedor de la página; devuelve la limpieza (saca solo el suyo). */
export function setCommandContext(next: Provider): () => void {
  providers = [...providers.filter((p) => p !== next), next];
  return () => {
    providers = providers.filter((p) => p !== next);
  };
}

export function getCommandContext(): CommandContext | null {
  try {
    const top = providers[providers.length - 1];
    return top ? top() : null;
  } catch {
    return null;
  }
}

export const OPEN_SEARCH_EVENT = 'zs:open-search';
/** La paleta se cerró (las páginas sueltan los objetivos que fijaron al abrirla). */
export const CMDK_CLOSED_EVENT = 'zs:cmdk-closed';

export interface CommandAnchor {
  top: number;
  left: number;
  bottom: number;
  width: number;
}

export interface OpenCommandOptions {
  /** Abre la página como menú anclado al elemento (el chip de una propiedad), como en Linear. */
  anchor?: Element | null;
  /** Issue sobre el que actúa (una fila con su menú "…"), en vez de la fila bajo el mouse. */
  targetId?: string;
}

export interface OpenCommandDetail {
  page?: string;
  anchor?: CommandAnchor;
  targetId?: string;
}

/** Abre la paleta; con `page` entra directo a esa página de opciones. */
export function openCommandMenu(page?: string, opts: OpenCommandOptions = {}): void {
  const r = opts.anchor?.getBoundingClientRect();
  const detail: OpenCommandDetail | undefined =
    page || r || opts.targetId
      ? {
          page,
          anchor: r ? { top: r.top, left: r.left, bottom: r.bottom, width: r.width } : undefined,
          targetId: opts.targetId,
        }
      : undefined;
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail }));
}

/** Busca una acción por id en el árbol (las páginas se resuelven en el momento). */
export function findAction(actions: CommandAction[], id: string): CommandAction | null {
  for (const a of actions) {
    if (a.id === id) return a;
  }
  return null;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Filtro de la paleta: todas las palabras tienen que aparecer en label o keywords (sin tildes). */
export function matchesQuery(action: Pick<CommandAction, 'label' | 'keywords' | 'meta'>, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold(`${action.label} ${action.keywords ?? ''}`);
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Qué tan bien coincide el label: 0 empieza igual, 1 una palabra empieza, 2 contiene, 3 solo keywords, -1 no. */
export function queryRank(action: Pick<CommandAction, 'label' | 'keywords'>, query: string): number {
  const q = fold(query.trim());
  if (!q) return 0;
  const l = fold(action.label);
  if (l.startsWith(q)) return 0;
  if (l.split(/[\s(“"'·›/-]+/).some((w) => w.startsWith(q))) return 1;
  if (l.includes(q)) return 2;
  return matchesQuery(action, query) ? 3 : -1;
}

/**
 * Opciones de una página según lo tipeado (como los menús de Linear): primero
 * lo que empieza con el texto, las opciones "Sin X" al final y solo si
 * coinciden, y lo que vino del servidor (`fromServer`) aunque no coincida el
 * label (el servidor busca en más campos). Con el input vacío, el orden original.
 */
export function rankPageItems(items: CommandAction[], query: string, fromServer: ReadonlySet<CommandAction> = new Set()): CommandAction[] {
  if (!query.trim()) return items;
  const scored = items
    .map((a, i) => {
      let r = queryRank(a, query);
      if (r < 0 && fromServer.has(a) && !a.isNone) r = 3;
      if (a.isNone && r >= 0) r += 10;
      return { a, i, r };
    })
    .filter((x) => x.r >= 0);
  scored.sort((x, y) => x.r - y.r || x.i - y.i);
  return scored.map((x) => x.a);
}

/** ¿Lo tipeado ya es exactamente una de las opciones? (para no ofrecer crearla). */
export function hasExactOption(items: CommandAction[], query: string): boolean {
  const q = fold(query.trim());
  return items.some((a) => fold(a.label) === q);
}
