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
}

export interface CommandContext {
  /** Encabezado del grupo: "ZER-12" o "3 issues". */
  title: string;
  actions: CommandAction[];
}

type Provider = () => CommandContext | null;

let provider: Provider | null = null;

/** Registra el proveedor de la página; devuelve la limpieza (solo borra si sigue siendo el suyo). */
export function setCommandContext(next: Provider): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function getCommandContext(): CommandContext | null {
  try {
    return provider ? provider() : null;
  } catch {
    return null;
  }
}

export const OPEN_SEARCH_EVENT = 'zs:open-search';
/** La paleta se cerró (las páginas sueltan los objetivos que fijaron al abrirla). */
export const CMDK_CLOSED_EVENT = 'zs:cmdk-closed';

/** Abre la paleta; con `page` entra directo a esa página de opciones. */
export function openCommandMenu(page?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: page ? { page } : undefined }));
}

/** Busca una acción por id en el árbol (las páginas se resuelven en el momento). */
export function findAction(actions: CommandAction[], id: string): CommandAction | null {
  for (const a of actions) {
    if (a.id === id) return a;
  }
  return null;
}

/** Filtro de la paleta: todas las palabras tienen que aparecer en label o keywords. */
export function matchesQuery(action: Pick<CommandAction, 'label' | 'keywords' | 'meta'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${action.label} ${action.keywords ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
