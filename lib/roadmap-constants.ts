// Constantes del roadmap sin dependencias de servidor (las usan componentes cliente).

import { PRODUCT_COLOR } from './product-taxonomy';

/**
 * Estados de un ítem.
 * - proposed: triage privado (lo crea la clasificación del feedback). Nunca público.
 * - idea: público, recién propuesto (board o un admin lo aprueba).
 * - considering / planned / in_progress: abiertos, se votan.
 * - done: lanzado (link al changelog).
 * - declined: cerrado, visible como "Cerrado" con su motivo.
 */
export const ROADMAP_STATUSES = ['proposed', 'idea', 'considering', 'planned', 'in_progress', 'done', 'declined'] as const;
export const ROADMAP_KINDS = ['idea', 'bug'] as const;
/** Estados en los que un ítem sigue abierto (recibe señales del feedback). */
export const ROADMAP_OPEN_STATUSES: readonly string[] = ['proposed', 'idea', 'considering', 'planned', 'in_progress'];
/** Estados visibles en el board público (si además is_public = 1). */
export const ROADMAP_PUBLIC_STATUSES = ['idea', 'considering', 'planned', 'in_progress', 'done', 'declined'] as const;
/** Estados públicos que aceptan votos. */
export const ROADMAP_VOTABLE_STATUSES: readonly string[] = ['idea', 'considering', 'planned', 'in_progress'];
/** Columnas del roadmap público (vista kanban de lo comprometido). */
export const ROADMAP_PUBLIC_COLUMNS = ['planned', 'in_progress', 'done'] as const;
/** Columnas del backlog (vista por columnas del board). */
export const BOARD_COLUMNS = ['idea', 'considering', 'planned', 'in_progress', 'done'] as const;
/** Cambios de estado que se avisan por email a los suscriptos. */
export const ROADMAP_NOTIFY_STATUSES: readonly string[] = ['planned', 'in_progress', 'done'];
/** Lo que devuelve el clasificador; solo idea y bug generan ítems. */
export const SIGNAL_KINDS = ['bug', 'idea', 'question', 'praise', 'other'] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export type RoadmapPublicStatus = (typeof ROADMAP_PUBLIC_STATUSES)[number];
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const BOARD_SORTS = ['top', 'new', 'trending'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

/** Color de cada producto: la taxonomía compartida (lib/product-taxonomy.ts). */
export const ROADMAP_PRODUCT_COLOR: Record<string, string> = PRODUCT_COLOR;

export function isPublicStatus(status: string): status is RoadmapPublicStatus {
  return (ROADMAP_PUBLIC_STATUSES as readonly string[]).includes(status);
}

/** Slug ASCII para la URL del ítem (/i/<id>-<slug>). */
export function slugifyTitle(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'item'
  );
}

/** Segmento de la URL de detalle: <id>-<slug>. */
export function itemRef(id: string, title: string): string {
  return `${id}-${slugifyTitle(title)}`;
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Id a partir del segmento <id>-<slug> (los ids son UUID o sin guiones, p. ej. rm_seed_flow). */
export function idFromRef(ref: string): string {
  const decoded = decodeURIComponent(ref);
  const uuid = UUID_PREFIX.exec(decoded);
  if (uuid) return uuid[0].toLowerCase();
  const dash = decoded.indexOf('-');
  return dash === -1 ? decoded : decoded.slice(0, dash);
}
