// Constantes del roadmap sin dependencias de servidor (las usan componentes cliente).

export const ROADMAP_STATUSES = ['proposed', 'planned', 'in_progress', 'done', 'declined'] as const;
export const ROADMAP_KINDS = ['idea', 'bug'] as const;
/** Estados en los que un ítem sigue abierto (recibe señales y votos). */
export const ROADMAP_OPEN_STATUSES: readonly string[] = ['proposed', 'planned', 'in_progress'];
/** Columnas del roadmap público. */
export const ROADMAP_PUBLIC_COLUMNS = ['planned', 'in_progress', 'done'] as const;
/** Lo que devuelve el clasificador; solo idea y bug generan ítems. */
export const SIGNAL_KINDS = ['bug', 'idea', 'question', 'praise', 'other'] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Color de cada producto (tokens --c-* de globals.css). */
export const ROADMAP_PRODUCT_COLOR: Record<string, string> = {
  link: 'var(--c-link)',
  crm: 'var(--c-crm)',
  cal: 'var(--c-cal)',
  track: 'var(--c-track)',
  chat: 'var(--c-chat)',
  docs: 'var(--c-docs)',
  site: 'var(--ink)',
  other: 'var(--dim)',
};
