/**
 * Anterior / siguiente registro (C3), como en HubSpot: la tabla o el board
 * guardan en sessionStorage el orden de lo que la persona tiene en pantalla
 * (con sus filtros y su orden) y la ficha y la vista previa caminan por esa
 * lista. Solo ids que la persona ya vio; la ficha de cada uno vuelve a pasar
 * por el alcance del servidor.
 */
export type NavEntity = 'contacts' | 'companies' | 'deals';

export interface ListNav {
  ids: string[];
  /** La lista de donde vino, sin locale y con sus filtros (`/app/crm/contacts?sort=…`). */
  href: string;
}

/** Tope de ids guardados (una página grande o un board entero). */
export const MAX_NAV_IDS = 1000;

const key = (entity: NavEntity) => `zs:crm:nav:${entity}`;

export function saveListNav(entity: NavEntity, nav: ListNav): void {
  try {
    window.sessionStorage.setItem(key(entity), JSON.stringify({ ids: nav.ids.slice(0, MAX_NAV_IDS), href: nav.href }));
  } catch {
    // Sin storage (modo privado, cuota): sin anterior / siguiente.
  }
}

export function readListNav(entity: NavEntity): ListNav | null {
  try {
    const raw = window.sessionStorage.getItem(key(entity));
    return raw ? parseListNav(raw) : null;
  } catch {
    return null;
  }
}

/** Lee lo guardado sin confiar en la forma: ids de texto y un href interno del CRM. */
export function parseListNav(raw: string): ListNav | null {
  try {
    const v = JSON.parse(raw) as { ids?: unknown; href?: unknown };
    if (!Array.isArray(v.ids) || typeof v.href !== 'string') return null;
    const ids = v.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, MAX_NAV_IDS);
    // Solo una ruta del CRM de este sitio (nunca otro origen ni `//`).
    const href = /^\/app\/crm\/[a-z0-9/_-]*(\?[^#]*)?$/i.test(v.href) ? v.href : '';
    return { ids, href };
  } catch {
    return null;
  }
}

export interface Neighbors {
  prev: string | null;
  next: string | null;
  /** 0-based; -1 si el registro no está en la lista. */
  index: number;
  total: number;
}

export function neighbors(ids: readonly string[], id: string): Neighbors {
  const index = ids.indexOf(id);
  if (index < 0) return { prev: null, next: null, index: -1, total: ids.length };
  return { prev: index > 0 ? ids[index - 1] : null, next: index < ids.length - 1 ? ids[index + 1] : null, index, total: ids.length };
}

/**
 * ¿La tecla es un atajo de anterior / siguiente? `k` anterior y `j` siguiente
 * (como Linear y Gmail), sin modificadores y nunca mientras se escribe.
 */
export function navKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented'> & { target: EventTarget | null }): 'prev' | 'next' | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return null;
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))) return null;
  if (e.key === 'k' || e.key === 'K') return 'prev';
  if (e.key === 'j' || e.key === 'J') return 'next';
  return null;
}
