/**
 * Ficha en tres columnas (contacto, empresa, deal): lógica pura de las
 * pestañas, de las acciones rápidas y del estado plegado de las tarjetas.
 *
 * En pantalla ancha la ficha muestra tres columnas a la vez: propiedades a la
 * izquierda, la pestaña del medio (Resumen o Actividad) y las asociaciones a
 * la derecha. En pantalla angosta queda una sola columna y las propiedades y
 * las asociaciones pasan a ser dos pestañas más. Las cuatro comparten `?tab=`,
 * con los mismos valores que la ficha anterior (`properties`, `related`) para
 * que los links guardados sigan abriendo lo mismo. Cambiar de pestaña es del
 * navegador: la ficha ya trae todo y no vuelve a pedirlo.
 */

export const LAYOUT_TABS = ['overview', 'activity', 'properties', 'related'] as const;
export type LayoutTab = (typeof LAYOUT_TABS)[number];

/** Pestañas que existen solo en una columna; en tres columnas ya están a la vista. */
export const NARROW_ONLY_TABS: readonly LayoutTab[] = ['properties', 'related'];

/**
 * Ancho de ventana desde el que la ficha tiene tres columnas. Es el mismo
 * número que usa styles/crm-record-layout.css: si cambia uno, cambia el otro.
 */
export const WIDE_MIN_PX = 1240;
export const WIDE_QUERY = `(min-width: ${WIDE_MIN_PX}px)`;

/**
 * `?tab=` → pestaña válida. Sin parámetro (o con cualquier otra cosa) abre el
 * Resumen, como HubSpot. `activities` vale como `activity`.
 */
export function parseLayoutTab(value: string | string[] | undefined): LayoutTab {
  if (value === 'activities') return 'activity';
  return typeof value === 'string' && (LAYOUT_TABS as readonly string[]).includes(value)
    ? (value as LayoutTab)
    : 'overview';
}

export type MiddlePanel = 'overview' | 'activity';

/**
 * Qué muestra la columna del medio. Con `properties` y `related` (pestañas de
 * una columna) el medio queda en el Resumen, que es donde siguen estando los
 * productos y las cotizaciones de los links guardados (`?tab=related#quotes`).
 */
export function middlePanelFor(tab: LayoutTab): MiddlePanel {
  return tab === 'activity' ? 'activity' : 'overview';
}

/** Pestaña que se marca como activa: en tres columnas, la del panel del medio. */
export function shownTab(tab: LayoutTab, wide: boolean): LayoutTab {
  return wide && NARROW_ONLY_TABS.includes(tab) ? middlePanelFor(tab) : tab;
}

/** Href a una pestaña del mismo registro; el Resumen es la ruta sin parámetros. */
export function layoutTabHref(base: string, tab: LayoutTab): string {
  return tab === 'overview' ? base : `${base}?tab=${tab}`;
}

/** Anclas que viven en el Resumen: un link viejo a ellas abre esa pestaña. */
export const OVERVIEW_ANCHORS: readonly string[] = ['line-items', 'quotes'];

/** Pestaña a mostrar para un link con ancla (`?tab=related#line-items` → Resumen). */
export function tabForHash(tab: LayoutTab, hash: string): LayoutTab {
  return OVERVIEW_ANCHORS.includes(hash.replace(/^#/, '')) ? 'overview' : tab;
}

// ---------- Acciones rápidas ----------

export const COMPOSE_TYPES = ['note', 'email', 'call', 'task', 'meeting'] as const;
export type ComposeType = (typeof COMPOSE_TYPES)[number];

/** `?compose=` → tipo de actividad a abrir en el composer, o null. */
export function parseCompose(value: string | string[] | undefined): ComposeType | null {
  return typeof value === 'string' && (COMPOSE_TYPES as readonly string[]).includes(value)
    ? (value as ComposeType)
    : null;
}

/** Lo emite una acción rápida; la ficha pasa a Actividad y después avisa al timeline. */
export const COMPOSE_REQUEST_EVENT = 'crm:compose-request';
/** Lo escucha el timeline cuando ya está en pantalla. */
export const COMPOSE_EVENT = 'crm:compose';

/** Tipos de actividad que cuentan como comunicación (Resumen › Comunicaciones recientes). */
export const COMMUNICATION_TYPES: readonly string[] = ['email', 'call', 'meeting'];

/** Las últimas comunicaciones de una lista ya ordenada de más nueva a más vieja. */
export function recentCommunications<T extends { type: string }>(items: T[], limit = 5): T[] {
  return items.filter((i) => COMMUNICATION_TYPES.includes(i.type)).slice(0, limit);
}

// ---------- Tarjetas plegables ----------

/** Una sola clave: { "<objeto>.<tarjeta>": true } para las plegadas. Vale para todos los registros del objeto. */
export const CARDS_STORAGE_KEY = 'zs.crm.recordCards.v1';

export type CollapsedCards = Record<string, true>;

/** Lee el JSON guardado; cualquier cosa rara es "nada plegado". */
export function parseCollapsed(raw: string | null | undefined): CollapsedCards {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: CollapsedCards = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === true && key.length <= 80) out[key] = true;
    }
    return out;
  } catch {
    return {};
  }
}

/** Devuelve un mapa nuevo con la tarjeta plegada o abierta (las abiertas no se guardan). */
export function withCollapsed(map: CollapsedCards, id: string, collapsed: boolean): CollapsedCards {
  const next: CollapsedCards = { ...map };
  if (collapsed) next[id] = true;
  else delete next[id];
  return next;
}

// ---------- Identidad ----------

/** Iniciales para el avatar: primeras letras de las dos primeras palabras; con un email, su primera letra. */
export function recordInitials(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean) return '?';
  const words = clean.includes('@') && !clean.includes(' ') ? [clean] : clean.split(/\s+/).filter(Boolean);
  const out = words
    .slice(0, 2)
    .map((w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '')
    .join('');
  return out.toUpperCase() || '?';
}
