/**
 * Ficha en tres columnas (contacto, empresa, deal): lógica pura de las
 * pestañas, de las acciones rápidas y del estado plegado de las tarjetas.
 *
 * En pantalla ancha la ficha muestra tres columnas a la vez: propiedades a la
 * izquierda, la pestaña del medio (Resumen o Actividad) y las asociaciones a
 * la derecha. En pantalla angosta queda una sola columna y las propiedades y
 * las asociaciones pasan a ser dos pestañas más. Las cuatro comparten `?tab=`,
 * con los mismos valores que la ficha anterior (`properties`, `related`) para
 * que los links guardados sigan abriendo lo mismo.
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

/** `?tab=` → pestaña válida; cualquier otra cosa cae en Actividad (el default). */
export function parseLayoutTab(value: string | string[] | undefined): LayoutTab {
  return typeof value === 'string' && (LAYOUT_TABS as readonly string[]).includes(value)
    ? (value as LayoutTab)
    : 'activity';
}

export type MiddlePanel = 'overview' | 'activity';

/**
 * Qué muestra la columna del medio. Con `properties` y `related` (pestañas de
 * una columna) el medio sigue cargado para la pantalla ancha: Actividad con
 * las propiedades, Resumen con las asociaciones.
 */
export function middlePanelFor(tab: LayoutTab): MiddlePanel {
  return tab === 'overview' || tab === 'related' ? 'overview' : 'activity';
}

/** Pestaña que se marca como activa: en tres columnas, la del panel del medio. */
export function shownTab(tab: LayoutTab, wide: boolean): LayoutTab {
  return wide && NARROW_ONLY_TABS.includes(tab) ? middlePanelFor(tab) : tab;
}

/** Href a una pestaña del mismo registro; Actividad es la ruta sin parámetros. */
export function layoutTabHref(base: string, tab: LayoutTab): string {
  return tab === 'activity' ? base : `${base}?tab=${tab}`;
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

/** Evento que escucha el timeline cuando ya está en pantalla. */
export const COMPOSE_EVENT = 'crm:compose';

export function composeHref(base: string, type: ComposeType): string {
  return `${base}?tab=activity&compose=${type}`;
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
