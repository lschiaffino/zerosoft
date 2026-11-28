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
  /**
   * Vino de una tabla: la ficha puede pedir la vista entera (GET /api/crm/view-nav,
   * hasta 2000) y no solo la página en pantalla. El board recorre sus tarjetas.
   */
  table?: true;
  /** Ya son los ids de la vista entera (no se vuelven a pedir en cada ficha). */
  full?: true;
}

/** Tope de ids guardados (la vista entera de una tabla o un board). */
export const MAX_NAV_IDS = 2000;

const key = (entity: NavEntity) => `zs:crm:nav:${entity}`;

export function saveListNav(entity: NavEntity, nav: ListNav): void {
  try {
    window.sessionStorage.setItem(key(entity), JSON.stringify({ ...nav, ids: nav.ids.slice(0, MAX_NAV_IDS) }));
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
    const v = JSON.parse(raw) as { ids?: unknown; href?: unknown; table?: unknown; full?: unknown };
    if (!Array.isArray(v.ids) || typeof v.href !== 'string') return null;
    const ids = v.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, MAX_NAV_IDS);
    // Solo una ruta del CRM de este sitio (nunca otro origen ni `//`).
    const href = /^\/app\/crm\/[a-z0-9/_-]*(\?[^#]*)?$/i.test(v.href) ? v.href : '';
    return { ids, href, ...(v.table === true ? { table: true as const } : {}), ...(v.full === true ? { full: true as const } : {}) };
  } catch {
    return null;
  }
}

/**
 * La query de la vista para pedir sus ids enteros (GET /api/crm/view-nav), o
 * null si no hace falta: vino del board, ya es la vista entera, el registro no
 * está en lo guardado o la lista es de otra parte.
 */
export function viewNavQuery(nav: ListNav | null, entity: NavEntity, id: string): string | null {
  if (!nav || !nav.table || nav.full || !nav.ids.includes(id)) return null;
  const [path, qs = ''] = nav.href.split('?');
  return path === `/app/crm/${entity}` ? qs : null;
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
